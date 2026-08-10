import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  defaultPolicyEvaluation,
  downgradeUnsafeShellSyntax,
  normalizePolicyPath,
  policyRuleMatches,
  SOURCE_PRIORITY,
} from "./policy-classification.js"
import type { ApprovalChoice, ApprovalMode, PermissionRule, PolicyEvaluation } from "./policy-contracts.js"
import { readPermissionRules, systemPermissionFile, userPermissionFile } from "./policy-store.js"

export class PolicyEngine {
  private readonly sessionRules: PermissionRule[] = []
  private modeSource: (() => ApprovalMode) | null = null

  constructor(
    readonly workspace: string,
    private currentMode: ApprovalMode,
    private readonly rules: PermissionRule[] = [],
    readonly headless = false,
    private readonly persistentFile = userPermissionFile(),
  ) {}

  get mode() { return this.modeSource?.() ?? this.currentMode }

  evaluate(tool: string, args: Record<string, unknown>): PolicyEvaluation {
    const builtin = defaultPolicyEvaluation(tool, args, this.mode)
    if (builtin.decision === "deny") return builtin
    if (builtin.decision === "ask" && builtin.risk === "critical") return this.headless
      ? { ...builtin, decision: "deny", reason: `${builtin.reason}; headless mode fails closed` }
      : builtin
    const matches = [...this.rules, ...this.sessionRules]
      .filter((rule) => policyRuleMatches(rule, tool, args))
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
      return this.headless && evaluated.decision === "ask"
        ? { ...evaluated, decision: "deny", reason: `${evaluated.reason}; headless mode fails closed` }
        : evaluated
    }
    if (this.headless && builtin.decision === "ask") return { ...builtin, decision: "deny", reason: `${builtin.reason}; headless mode fails closed` }
    const evaluated = this.mode === "full-access" ? builtin : downgradeUnsafeShellSyntax(builtin, tool, args)
    return this.headless && evaluated.decision === "ask"
      ? { ...evaluated, decision: "deny", reason: `${evaluated.reason}; headless mode fails closed` }
      : evaluated
  }

  async remember(choice: ApprovalChoice, tool: string, args: Record<string, unknown>) {
    if (choice !== "session" && choice !== "always") return
    const rule: PermissionRule = {
      id: `${choice}.${tool}.${Date.now().toString(36)}`,
      tool,
      decision: "allow",
      priority: 500,
      source: choice === "session" ? "session" : "user",
      ...(typeof args.path === "string" ? { pathGlob: normalizePolicyPath(args.path) } : {}),
      ...(typeof args.command === "string" ? { commandExact: String(args.command) } : {}),
    }
    if (choice === "session") this.sessionRules.push(rule)
    else {
      const existing = await readPermissionRules(this.persistentFile, "user")
      await mkdir(path.dirname(this.persistentFile), { recursive: true })
      await writeFile(this.persistentFile, `${JSON.stringify({ version: 1, rules: [...existing, rule] }, null, 2)}\n`, { mode: 0o600 })
      this.rules.push(rule)
    }
  }

  snapshot() {
    return {
      mode: this.mode,
      headless: this.headless,
      rules: [...this.rules, ...this.sessionRules].map(({ id, tool, pathGlob, commandPrefix, commandExact, commandPattern, decision, priority, source }) => ({ id, tool, pathGlob, commandPrefix, commandExact, commandPattern, decision, priority, source })),
    }
  }

  setMode(mode: ApprovalMode) { this.currentMode = mode }
  setModeSource(source: (() => ApprovalMode) | null) { this.modeSource = source }
}

export async function createPolicyEngine(workspace: string, mode: ApprovalMode, options: { headless?: boolean; configDirectory?: string } = {}) {
  const userFile = userPermissionFile(options.configDirectory)
  const [system, user, project] = await Promise.all([
    readPermissionRules(systemPermissionFile(), "system"),
    readPermissionRules(userFile, "user"),
    readPermissionRules(path.join(path.resolve(workspace), ".do-code", "permissions.json"), "project"),
  ])
  return new PolicyEngine(path.resolve(workspace), mode, [...system, ...user, ...project], options.headless ?? false, userFile)
}
