import type {
  ApprovalMode,
  PermissionRule,
  PolicyEvaluation,
  SandboxNetworkMode,
} from "./policy-contracts.js"
import { TOOL_NAMES, TOOL_PREFIXES } from "./tool-names.js"

const WRITE_TOOLS = new Set<string>([TOOL_NAMES.WRITE_FILE, TOOL_NAMES.EDIT_FILE, TOOL_NAMES.APPLY_PATCH])
const MUTATING_TOOLS = new Set<string>([...WRITE_TOOLS, TOOL_NAMES.MEMORY_WRITE, TOOL_NAMES.MEMORY_DELETE, TOOL_NAMES.WRITE_TASK_NOTE, TOOL_NAMES.SHELL, TOOL_NAMES.SHELL_START, TOOL_NAMES.SHELL_PTY_START, TOOL_NAMES.SHELL_SEND, TOOL_NAMES.SHELL_RESIZE, TOOL_NAMES.SHELL_STOP])
const SHELL_EXECUTION_TOOLS = new Set<string>([TOOL_NAMES.SHELL, TOOL_NAMES.SHELL_START, TOOL_NAMES.SHELL_PTY_START])
const SHELL_CONTROL_TOOLS = new Set<string>([TOOL_NAMES.SHELL_SEND, TOOL_NAMES.SHELL_RESIZE, TOOL_NAMES.SHELL_STOP])
const WEB_TOOLS = new Set<string>([TOOL_NAMES.WEB_FETCH, TOOL_NAMES.WEB_SEARCH])
const SENSITIVE = /(^|\/)(\.env(?:\..*)?|credentials?|secrets?|id_rsa|id_ed25519|\.npmrc|\.pypirc|.*\.(?:pem|key|p12))(\/|$)/i
const GIT_INTERNAL = /(^|\/)\.git(?:\/|$)/i
const DANGEROUS_SHELL = /(^|[;&|]\s*)(sudo\b|rm\s+-[^\n]*r|git\s+(reset\s+--hard|clean\s+-|push\s+[^\n]*--force)|dd\s+if=|mkfs\b|chmod\s+-R|chown\s+-R)|curl[^\n|]*\|\s*(sh|bash)|wget[^\n|]*\|\s*(sh|bash)/i
const CATASTROPHIC_SHELL = /rm\s+-[^\n]*r[^\n]*(?:\s\/\s*$|\s~(?:\/|\s|$))|mkfs\b|dd\s+[^\n]*of=\/dev\/|:\(\)\s*\{\s*:\|:&\s*;\s*\}/i
const NETWORK_SHELL = /(^|[;&|]\s*)(curl|wget|ssh|scp|rsync|nc|ncat|telnet)\b|\b(?:npm|pnpm|yarn)\s+(?:install|add|publish)|\bpip(?:3)?\s+install|\bgit\s+(?:clone|fetch|pull|push)\b/i
const LOCAL_SERVER_SHELL = /\b(?:npm|pnpm|yarn|bun)\s+(?:(?:run|run-script)\s+)?(?:dev|serve|start|preview)\b|\b(?:vite(?:\s+preview)?|next\s+(?:dev|start)|nuxt\s+(?:dev|preview|start)|astro\s+(?:dev|preview)|webpack(?:-dev-server|\s+serve)|ng\s+serve)\b|\bpython(?:3)?\s+-m\s+http\.server\b|\b(?:flask\s+run|uvicorn\b|gunicorn\b|manage\.py\s+runserver)\b|\bnode\b[^\n]*(?:\.listen\s*\(|createServer\s*\()/i

export const SOURCE_PRIORITY: Record<NonNullable<PermissionRule["source"]>, number> = {
  system: 4_000_000,
  session: 3_000_000,
  user: 2_000_000,
  project: 1_000_000,
}

export function normalizePolicyPath(value: unknown) {
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

export function policyRuleMatches(rule: PermissionRule, tool: string, args: Record<string, unknown>) {
  if (rule.tool && rule.tool !== "*" && rule.tool !== tool) return false
  const requestedPath = normalizePolicyPath(args.path)
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

export function planModeRestriction(tool: string): PolicyEvaluation | null {
  if (MUTATING_TOOLS.has(tool) || tool === TOOL_NAMES.MCP_SERVER || tool.startsWith(TOOL_PREFIXES.MCP) || tool.startsWith(TOOL_PREFIXES.HOOK)) {
    return { decision: "deny", risk: "high", reason: `Plan mode blocks ${tool}`, matchedRule: "interaction.plan" }
  }
  return null
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

export function downgradeUnsafeShellSyntax(evaluation: PolicyEvaluation, tool: string, args: Record<string, unknown>): PolicyEvaluation {
  if (!SHELL_EXECUTION_TOOLS.has(tool) || evaluation.decision !== "allow") return evaluation
  const syntax = inspectShellSyntax(String(args.command ?? ""))
  if (syntax.substitution) return { decision: "ask", risk: "high", reason: "Shell command substitution requires explicit approval", matchedRule: "builtin.shell-substitution" }
  if (syntax.outputRedirection) return { decision: "ask", risk: "high", reason: "Shell output redirection requires explicit approval", matchedRule: "builtin.shell-redirection" }
  return evaluation
}

export function defaultPolicyEvaluation(tool: string, args: Record<string, unknown>, mode: ApprovalMode): PolicyEvaluation {
  const requestedPath = normalizePolicyPath(args.path)
  const outsideWorkspace = args.__outsideWorkspace === true
  if (requestedPath && GIT_INTERNAL.test(requestedPath) && WRITE_TOOLS.has(tool) && mode !== "full-access") {
    return { decision: "deny", risk: "critical", reason: "Direct modification of Git internals is blocked", matchedRule: "builtin.protect-git" }
  }
  if (SHELL_EXECUTION_TOOLS.has(tool) || tool === TOOL_NAMES.MCP_SERVER || tool.startsWith(TOOL_PREFIXES.HOOK)) {
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
  if (WEB_TOOLS.has(tool)) {
    return mode !== "ask"
      ? { decision: "allow", risk: "medium", reason: `${mode} permits public read-only web access`, matchedRule: `mode.${mode}` }
      : { decision: "ask", risk: "medium", reason: "Public web access requires approval", matchedRule: "builtin.web-network" }
  }
  if (tool.startsWith(TOOL_PREFIXES.MCP)) return { decision: "ask", risk: "high", reason: "External MCP tools require explicit approval", matchedRule: "builtin.external-tool" }
  if (SHELL_CONTROL_TOOLS.has(tool)) return { decision: "allow", risk: "medium", reason: `${mode} permits ${tool}`, matchedRule: `mode.${mode}` }
  if (outsideWorkspace && mode !== "full-access") return { decision: "ask", risk: "high", reason: "Access outside the current workspace requires approval", matchedRule: "builtin.outside-workspace" }
  if (requestedPath && SENSITIVE.test(requestedPath) && mode !== "full-access") return { decision: "ask", risk: "high", reason: "The requested path may contain credentials or secrets", matchedRule: "builtin.sensitive-file" }
  if (WRITE_TOOLS.has(tool)) return { decision: "allow", risk: "medium", reason: `${mode} permits workspace edits`, matchedRule: `mode.${mode}` }
  return { decision: "allow", risk: "low", reason: "Read-only workspace tool", matchedRule: "builtin.read-only" }
}
