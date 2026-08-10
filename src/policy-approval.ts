import { defaultPolicyEvaluation } from "./policy-classification.js"
import type {
  ApprovalChoice,
  ApprovalMode,
  PermissionDecision,
  PolicyEvaluation,
  ToolApprovalRequest,
} from "./policy-contracts.js"
import { TOOL_NAMES, TOOL_PREFIXES } from "./tool-names.js"

const SHELL_APPROVAL_TOOLS = new Set<string>([TOOL_NAMES.SHELL, TOOL_NAMES.SHELL_START, TOOL_NAMES.SHELL_PTY_START])
const WEB_APPROVAL_TOOLS = new Set<string>([TOOL_NAMES.WEB_FETCH, TOOL_NAMES.WEB_SEARCH])
const SHELL_APPROVAL_TITLES: Partial<Record<string, string>> = { [TOOL_NAMES.SHELL_START]: "Start background command", [TOOL_NAMES.SHELL_PTY_START]: "Start interactive terminal command" }

export function approvalForTool(tool: string, args: Record<string, unknown>, mode: ApprovalMode): PermissionDecision {
  return defaultPolicyEvaluation(tool, args, mode).decision
}

export function approvalRequest(tool: string, args: Record<string, unknown>, evaluation: PolicyEvaluation = defaultPolicyEvaluation(tool, args, "ask")): ToolApprovalRequest {
  const requested = String(args.path ?? "")
  if (SHELL_APPROVAL_TOOLS.has(tool) || tool === TOOL_NAMES.MCP_SERVER || tool.startsWith(TOOL_PREFIXES.HOOK)) {
    const command = String(args.command ?? "")
    return {
      ...evaluation,
      tool,
      args,
      title: evaluation.risk === "critical" ? "High-risk shell command" : SHELL_APPROVAL_TITLES[tool] ?? "Run shell command",
      detail: command,
      dangerous: evaluation.risk === "critical",
    }
  }
  if (tool === TOOL_NAMES.EDIT_FILE) return { ...evaluation, tool, args, title: `Edit file ${requested}`, detail: `--- Original\n${String(args.old_text ?? "")}\n+++ Updated\n${String(args.new_text ?? "")}`, dangerous: evaluation.risk === "critical" || evaluation.risk === "high" }
  if (tool === TOOL_NAMES.APPLY_PATCH) return { ...evaluation, tool, args, title: "Apply workspace patch", detail: String(args.patch ?? ""), dangerous: evaluation.risk === "critical" || evaluation.risk === "high" }
  if (WEB_APPROVAL_TOOLS.has(tool)) return { ...evaluation, tool, args, title: tool === TOOL_NAMES.WEB_FETCH ? "Fetch web page" : "Search the web", detail: String(args.url ?? args.query ?? ""), dangerous: false }
  return { ...evaluation, tool, args, title: `${tool} ${requested}`.trim(), detail: requested || JSON.stringify(args, null, 2), dangerous: evaluation.risk === "critical" || evaluation.risk === "high" }
}

export function approved(choice: ApprovalChoice | boolean | undefined) {
  return choice === true || choice === "once" || choice === "session" || choice === "always"
}
