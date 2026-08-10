export type ApprovalMode = "ask" | "auto" | "full-access"
export type ExecutionApprovalMode = ApprovalMode
export type PermissionDecision = "allow" | "ask" | "deny"
export type PermissionRisk = "low" | "medium" | "high" | "critical"
export type ApprovalChoice = "deny" | "once" | "session" | "always"
export type SandboxNetworkMode = "none" | "local" | "full"

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

export type PolicyEngineContract = {
  mode: ApprovalMode
  evaluate(tool: string, args: Record<string, unknown>): PolicyEvaluation
  remember(choice: ApprovalChoice, tool: string, args: Record<string, unknown>): Promise<void>
}
