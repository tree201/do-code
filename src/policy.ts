import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { SandboxNetworkMode } from "./config.js"

export type ApprovalMode = "ask" | "auto" | "full-access"
export type ExecutionApprovalMode = ApprovalMode
export type PermissionDecision = "allow" | "ask" | "deny"
export type PermissionRisk = "low" | "medium" | "high" | "critical"
export type ApprovalChoice = "deny" | "once" | "session" | "always"

export type PermissionRule = {
  id: string
  tool?: string
  pathGlob?: string
  commandPrefix?: string
  commandExact?: string
  commandPattern?: string
  decision: PermissionDecision
  priority?: number
  source?: "system" | "user" | "project" | "session"
}

export type PolicyEvaluation = {
  decision: PermissionDecision
  risk: PermissionRisk
  reason: string
  matchedRule?: string
}

export type ToolApprovalRequest = PolicyEvaluation & {
  tool: string
  title: string
  detail: string
  dangerous: boolean
  args: Record<string, unknown>
}

const WRITE_TOOLS = new Set(["write_file", "edit_file", "apply_patch"])
const MUTATING_TOOLS = new Set([...WRITE_TOOLS, "shell", "shell_start", "shell_pty_start", "shell_send", "shell_resize", "shell_stop"])
const SENSITIVE = /(^|\/)(\.env(?:\..*)?|credentials?|secrets?|id_rsa|id_ed25519|\.npmrc|\.pypirc|.*\.(?:pem|key|p12))(\/|$)/i
const GIT_INTERNAL = /(^|\/)\.git(?:\/|$)/i
const DANGEROUS_SHELL = /(^|[;&|]\s*)(sudo\b|rm\s+-[^\n]*r|git\s+(reset\s+--hard|clean\s+-|push\s+[^\n]*--force)|dd\s+if=|mkfs\b|chmod\s+-R|chown\s+-R)|curl[^\n|]*\|\s*(sh|bash)|wget[^\n|]*\|\s*(sh|bash)/i
const CATASTROPHIC_SHELL = /rm\s+-[^\n]*r[^\n]*(?:\s\/\s*$|\s~(?:\/|\s|$))|mkfs\b|dd\s+[^\n]*of=\/dev\/|:\(\)\s*\{\s*:\|:&\s*;\s*\}/i
const NETWORK_SHELL = /(^|[;&|]\s*)(curl|wget|ssh|scp|rsync|nc|ncat|telnet)\b|\b(?:npm|pnpm|yarn)\s+(?:install|add|publish)|\bpip(?:3)?\s+install|\bgit\s+(?:clone|fetch|pull|push)\b/i
const LOCAL_SERVER_SHELL = /\b(?:npm|pnpm|yarn|bun)\s+(?:(?:run|run-script)\s+)?(?:dev|serve|start|preview)\b|\b(?:vite(?:\s+preview)?|next\s+(?:dev|start)|nuxt\s+(?:dev|preview|start)|astro\s+(?:dev|preview)|webpack(?:-dev-server|\s+serve)|ng\s+serve)\b|\bpython(?:3)?\s+-m\s+http\.server\b|\b(?:flask\s+run|uvicorn\b|gunicorn\b|manage\.py\s+runserver)\b|\bnode\b[^\n]*(?:\.listen\s*\(|createServer\s*\()/i
const SOURCE_PRIORITY: Record<NonNullable<PermissionRule["source"]>, number> = { system: 4_000_000, session: 3_000_000, user: 2_000_000, project: 1_000_000 }

/**
 * Plan mode is an interaction state, not an approval preset. Keep its read-only
 * boundary separate from the user's execution permissions so entering or
 * approving a plan never rewrites the active approval mode.
 */
export function planModeRestriction(tool: string): PolicyEvaluation | null {
  if (MUTATING_TOOLS.has(tool) || tool === "mcp_server" || tool.startsWith("mcp__") || tool.startsWith("hook__")) {
    return { decision: "deny", risk: "high", reason: `Plan mode blocks ${tool}`, matchedRule: "interaction.plan" }
  }
  return null
}

function normalizePath(value: unknown) {
  return typeof value === "string" ? value.replaceAll("\\", "/").replace(/^\.\//, "") : ""
}

function globRegex(glob: string) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*")
    .replaceAll("?", ".")
  return new RegExp(`^${escaped}$`, "i")
}

function ruleMatches(rule: PermissionRule, tool: string, args: Record<string, unknown>) {
  if (rule.tool && rule.tool !== "*" && rule.tool !== tool) return false
  const requestedPath = normalizePath(args.path)
  if (rule.pathGlob && (!requestedPath || !globRegex(rule.pathGlob).test(requestedPath))) return false
  const command = String(args.command ?? "")
  if (rule.commandPrefix && !command.startsWith(rule.commandPrefix)) return false
  if (rule.commandExact && command !== rule.commandExact) return false
  if (rule.commandPattern) {
    try { if (!new RegExp(rule.commandPattern, "i").test(command)) return false }
    catch { return false }
  }
  return true
}

export function isDangerousShell(command: string) {
  return DANGEROUS_SHELL.test(command)
}

export function isNetworkShell(command: string) {
  return NETWORK_SHELL.test(command)
}

export function shellNetworkMode(command: string): SandboxNetworkMode {
  if (isNetworkShell(command)) return "full"
  if (LOCAL_SERVER_SHELL.test(command)) return "local"
  return "none"
}

export function inspectShellSyntax(command: string) {
  let quote: "'" | '"' | null = null
  let escaped = false
  let substitution = false
  let outputRedirection = false
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!
    const next = command[index + 1]
    if (escaped) { escaped = false; continue }
    if (character === "\\" && quote !== "'") { escaped = true; continue }
    if (character === "'" || character === '"') {
      if (!quote) quote = character
      else if (quote === character) quote = null
      continue
    }
    if (quote === "'") continue
    if (character === "`" || (character === "$" && next === "(") || (!quote && (character === "<" || character === ">") && next === "(")) substitution = true
    if (!quote && character === ">") outputRedirection = true
  }
  return { substitution, outputRedirection }
}

function downgradeUnsafeShellSyntax(evaluation: PolicyEvaluation, tool: string, args: Record<string, unknown>): PolicyEvaluation {
  if ((tool !== "shell" && tool !== "shell_start" && tool !== "shell_pty_start") || evaluation.decision !== "allow") return evaluation
  const syntax = inspectShellSyntax(String(args.command ?? ""))
  if (syntax.substitution) return { decision: "ask", risk: "high", reason: "Shell command substitution requires explicit approval", matchedRule: "builtin.shell-substitution" }
  if (syntax.outputRedirection) return { decision: "ask", risk: "high", reason: "Shell output redirection requires explicit approval", matchedRule: "builtin.shell-redirection" }
  return evaluation
}

function defaultEvaluation(tool: string, args: Record<string, unknown>, mode: ApprovalMode): PolicyEvaluation {
  const requestedPath = normalizePath(args.path)
  const outsideWorkspace = args.__outsideWorkspace === true
  if (requestedPath && GIT_INTERNAL.test(requestedPath) && WRITE_TOOLS.has(tool) && mode !== "full-access") {
    return { decision: "deny", risk: "critical", reason: "Direct modification of Git internals is blocked", matchedRule: "builtin.protect-git" }
  }
  if (tool === "shell" || tool === "shell_start" || tool === "shell_pty_start" || tool === "mcp_server" || tool.startsWith("hook__")) {
    const command = String(args.command ?? "")
    if (CATASTROPHIC_SHELL.test(command)) return { decision: "deny", risk: "critical", reason: "Catastrophic system command is blocked", matchedRule: "builtin.catastrophic-shell" }
    if (isDangerousShell(command)) return mode === "full-access"
      ? { decision: "allow", risk: "critical", reason: "Full Access permits high-risk shell commands", matchedRule: "mode.full-access" }
      : { decision: "ask", risk: "critical", reason: "High-risk shell command requires explicit approval", matchedRule: "builtin.dangerous-shell" }
    if (isNetworkShell(command)) return mode === "ask"
      ? { decision: "ask", risk: "high", reason: "Command may access the network", matchedRule: "builtin.network-shell" }
      : { decision: "allow", risk: "medium", reason: `${mode} permits ordinary network commands`, matchedRule: `mode.${mode}` }
    return { decision: "allow", risk: "medium", reason: `${mode} permits ordinary commands`, matchedRule: `mode.${mode}` }
  }
  if (tool === "web_fetch" || tool === "web_search") {
    if (mode !== "ask") return { decision: "allow", risk: "medium", reason: `${mode} permits public read-only web access`, matchedRule: `mode.${mode}` }
    return { decision: "ask", risk: "medium", reason: "Public web access requires approval", matchedRule: "builtin.web-network" }
  }
  if (tool.startsWith("mcp__")) {
    return { decision: "ask", risk: "high", reason: "External MCP tools require explicit approval", matchedRule: "builtin.external-tool" }
  }
  if (tool === "shell_send" || tool === "shell_resize" || tool === "shell_stop") {
    return { decision: "allow", risk: "medium", reason: `${mode} permits ${tool}`, matchedRule: `mode.${mode}` }
  }
  if (outsideWorkspace && mode !== "full-access") {
    return { decision: "ask", risk: "high", reason: "Access outside the current workspace requires approval", matchedRule: "builtin.outside-workspace" }
  }
  if (requestedPath && SENSITIVE.test(requestedPath) && mode !== "full-access") {
    return { decision: "ask", risk: "high", reason: "The requested path may contain credentials or secrets", matchedRule: "builtin.sensitive-file" }
  }
  if (WRITE_TOOLS.has(tool)) {
    return { decision: "allow", risk: "medium", reason: `${mode} permits workspace edits`, matchedRule: `mode.${mode}` }
  }
  return { decision: "allow", risk: "low", reason: "Read-only workspace tool", matchedRule: "builtin.read-only" }
}

export class PolicyEngine {
  private readonly sessionRules: PermissionRule[] = []

  constructor(
    readonly workspace: string,
    public mode: ApprovalMode,
    private readonly rules: PermissionRule[] = [],
    readonly headless = false,
    private readonly persistentFile = userPermissionFile(),
  ) {}

  evaluate(tool: string, args: Record<string, unknown>): PolicyEvaluation {
    const builtin = defaultEvaluation(tool, args, this.mode)
    if (builtin.decision === "deny") return builtin
    if (builtin.decision === "ask" && builtin.risk === "critical") return this.headless ? { ...builtin, decision: "deny", reason: `${builtin.reason}; headless mode fails closed` } : builtin
    const matches = [...this.rules, ...this.sessionRules]
      .filter((rule) => ruleMatches(rule, tool, args))
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
      .map((rule) => ({ rule, effectivePriority: SOURCE_PRIORITY[rule.source ?? "user"] + Math.max(-9_999, Math.min(9_999, rule.priority ?? 0)) }))
      .sort((left, right) => right.effectivePriority - left.effectivePriority)
      .map(({ rule }) => rule)
    const selected = matches[0]
    if (selected) {
      const selectedEvaluation = {
        decision: selected.decision,
        risk: selected.decision === "deny" ? "high" : builtin.risk,
        reason: `Matched ${selected.source ?? "user"} permission rule ${selected.id}`,
        matchedRule: selected.id,
      } satisfies PolicyEvaluation
      const evaluated = this.mode === "full-access" ? selectedEvaluation : downgradeUnsafeShellSyntax(selectedEvaluation, tool, args)
      return this.headless && evaluated.decision === "ask" ? { ...evaluated, decision: "deny", reason: `${evaluated.reason}; headless mode fails closed` } : evaluated
    }
    if (this.headless && builtin.decision === "ask") return { ...builtin, decision: "deny", reason: `${builtin.reason}; headless mode fails closed` }
    const evaluated = this.mode === "full-access" ? builtin : downgradeUnsafeShellSyntax(builtin, tool, args)
    return this.headless && evaluated.decision === "ask" ? { ...evaluated, decision: "deny", reason: `${evaluated.reason}; headless mode fails closed` } : evaluated
  }

  async remember(choice: ApprovalChoice, tool: string, args: Record<string, unknown>) {
    if (choice !== "session" && choice !== "always") return
    const rule: PermissionRule = {
      id: `${choice}.${tool}.${Date.now().toString(36)}`,
      tool,
      decision: "allow",
      priority: 500,
      source: choice === "session" ? "session" : "user",
      ...(typeof args.path === "string" ? { pathGlob: normalizePath(args.path) } : {}),
      ...(typeof args.command === "string" ? { commandExact: String(args.command) } : {}),
    }
    if (choice === "session") this.sessionRules.push(rule)
    else {
      const existing = await readRules(this.persistentFile, "user")
      await mkdir(path.dirname(this.persistentFile), { recursive: true })
      await writeFile(this.persistentFile, `${JSON.stringify({ version: 1, rules: [...existing, rule] }, null, 2)}\n`, { mode: 0o600 })
      this.rules.push(rule)
    }
  }

  snapshot() {
    return { mode: this.mode, headless: this.headless, rules: [...this.rules, ...this.sessionRules].map(({ id, tool, pathGlob, commandPrefix, commandExact, commandPattern, decision, priority, source }) => ({ id, tool, pathGlob, commandPrefix, commandExact, commandPattern, decision, priority, source })) }
  }

  setMode(mode: ApprovalMode) { this.mode = mode }
}

function userPermissionFile(configDirectory = path.join(os.homedir(), ".config", "do-code")) {
  return path.join(configDirectory, "permissions.json")
}

function systemPermissionFile() {
  return process.platform === "darwin" ? "/Library/Application Support/do-code/permissions.json" : process.platform === "win32" ? "C:\\ProgramData\\do-code\\permissions.json" : "/etc/do-code/permissions.json"
}

async function readRules(file: string, source: NonNullable<PermissionRule["source"]>): Promise<PermissionRule[]> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { rules?: unknown[] }
    if (!Array.isArray(parsed.rules)) return []
    return parsed.rules.flatMap((value, index) => {
      if (!value || typeof value !== "object") return []
      const raw = value as Record<string, unknown>
      if (raw.decision !== "allow" && raw.decision !== "ask" && raw.decision !== "deny") return []
      if (source === "project" && raw.decision !== "deny") return []
      return [{
        id: typeof raw.id === "string" ? raw.id : `${source}.${index}`,
        decision: raw.decision,
        source,
        ...(typeof raw.tool === "string" ? { tool: raw.tool } : {}),
        ...(typeof raw.pathGlob === "string" ? { pathGlob: raw.pathGlob } : {}),
        ...(typeof raw.commandPrefix === "string" ? { commandPrefix: raw.commandPrefix } : {}),
        ...(typeof raw.commandExact === "string" ? { commandExact: raw.commandExact } : {}),
        ...(typeof raw.commandPattern === "string" ? { commandPattern: raw.commandPattern } : {}),
        ...(typeof raw.priority === "number" ? { priority: raw.priority } : {}),
      }]
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "EACCES") return []
    throw error
  }
}

export async function createPolicyEngine(workspace: string, mode: ApprovalMode, options: { headless?: boolean; configDirectory?: string } = {}) {
  const userFile = userPermissionFile(options.configDirectory)
  const [system, user, project] = await Promise.all([
    readRules(systemPermissionFile(), "system"),
    readRules(userFile, "user"),
    readRules(path.join(path.resolve(workspace), ".do-code", "permissions.json"), "project"),
  ])
  return new PolicyEngine(path.resolve(workspace), mode, [...system, ...user, ...project], options.headless ?? false, userFile)
}

export function approvalForTool(tool: string, args: Record<string, unknown>, mode: ApprovalMode): PermissionDecision {
  return defaultEvaluation(tool, args, mode).decision
}

export function approvalRequest(tool: string, args: Record<string, unknown>, evaluation = defaultEvaluation(tool, args, "ask")): ToolApprovalRequest {
  const requested = String(args.path ?? "")
  if (tool === "shell" || tool === "shell_start" || tool === "shell_pty_start" || tool === "mcp_server" || tool.startsWith("hook__")) {
    const command = String(args.command ?? "")
    return { ...evaluation, tool, args, title: evaluation.risk === "critical" ? "High-risk shell command" : tool === "shell_pty_start" ? "Start interactive terminal command" : tool === "shell_start" ? "Start background command" : "Run shell command", detail: command, dangerous: evaluation.risk === "critical" }
  }
  if (tool === "edit_file") return { ...evaluation, tool, args, title: `Edit file ${requested}`, detail: `--- Original\n${String(args.old_text ?? "")}\n+++ Updated\n${String(args.new_text ?? "")}`, dangerous: evaluation.risk === "critical" || evaluation.risk === "high" }
  if (tool === "apply_patch") return { ...evaluation, tool, args, title: "Apply workspace patch", detail: String(args.patch ?? ""), dangerous: evaluation.risk === "critical" || evaluation.risk === "high" }
  if (tool === "web_fetch" || tool === "web_search") return { ...evaluation, tool, args, title: tool === "web_fetch" ? "Fetch web page" : "Search the web", detail: String(args.url ?? args.query ?? ""), dangerous: false }
  return { ...evaluation, tool, args, title: `${tool} ${requested}`.trim(), detail: requested || JSON.stringify(args, null, 2), dangerous: evaluation.risk === "critical" || evaluation.risk === "high" }
}

export function approved(choice: ApprovalChoice | boolean | undefined) {
  return choice === true || choice === "once" || choice === "session" || choice === "always"
}

function trustFile(configDirectory = path.join(os.homedir(), ".config", "do-code")) {
  return path.join(configDirectory, "trusted-workspaces.json")
}

async function loadTrust(configDirectory?: string) {
  try {
    const parsed = JSON.parse(await readFile(trustFile(configDirectory), "utf8")) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch { return [] }
}

export async function isWorkspaceTrusted(workspace: string, configDirectory?: string) {
  const target = path.resolve(workspace)
  return (await loadTrust(configDirectory)).some((trusted) => target === trusted || target.startsWith(`${trusted}${path.sep}`))
}

export async function setWorkspaceTrusted(workspace: string, trusted: boolean, configDirectory?: string) {
  const file = trustFile(configDirectory)
  const target = path.resolve(workspace)
  const current = new Set(await loadTrust(configDirectory))
  if (trusted) current.add(target); else current.delete(target)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify([...current].sort(), null, 2)}\n`, "utf8")
  return trusted
}
