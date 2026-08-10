import path from "node:path"
import { approved, approvalForTool, approvalRequest } from "./policy-approval.js"
import { planModeRestriction } from "./policy-classification.js"
import type { ToolContext, ToolImplementation, ToolResult } from "./tool-contracts.js"
import { delegateTaskTool, interactionTools } from "./tool-definitions-interaction.js"
import { fileTools } from "./tool-definitions-file.js"
import { patchTools } from "./tool-definitions-patch.js"
import { shellProcessTools } from "./tool-definitions-shell-process.js"
import { webTools } from "./tool-definitions-web.js"
import { createToolPresentation } from "./tool-presentation.js"
import { assertRealPathsInside, pathIsOutsideWorkspace } from "./workspace-paths.js"
import { TOOL_NAMES } from "./tool-names.js"

const LEGACY_SHELL_APPROVAL_TOOLS = new Set<string>([TOOL_NAMES.SHELL, TOOL_NAMES.SHELL_START])
const DIRECT_WRITE_TOOLS = new Set<string>([TOOL_NAMES.WRITE_FILE, TOOL_NAMES.EDIT_FILE])

export const builtInTools: ToolImplementation[] = [
  ...webTools,
  delegateTaskTool,
  ...fileTools,
  ...interactionTools,
  ...patchTools,
  ...shellProcessTools,
]

const byName = new Map(builtInTools.map((tool) => [tool.definition.function.name, tool]))

export const toolDefinitions = builtInTools.map((tool) => tool.definition)

export async function executeTool(name: string, args: unknown, context: ToolContext): Promise<ToolResult> {
  const tool = byName.get(name)
  if (!tool) return { ok: false, output: `Unknown tool: ${name}` }
  try {
    const record = typeof args === "object" && args !== null ? args as Record<string, unknown> : {}
    const requestedPaths = [
      ...(typeof record.path === "string" ? [record.path] : []),
      ...(Array.isArray(record.include) ? record.include.filter((item): item is string => typeof item === "string" && !/[?*\[]/.test(item)) : []),
    ]
    let outsideWorkspace = requestedPaths.some((requested) => pathIsOutsideWorkspace(context.workspace, requested))
    let pathsValidated = false
    if (!outsideWorkspace) {
      try { await assertRealPathsInside(context.workspace, requestedPaths); pathsValidated = true }
      catch (error) {
        if (error instanceof Error && /Path escapes workspace/.test(error.message)) outsideWorkspace = true
        else throw error
      }
    }
    const policyRecord = outsideWorkspace ? { ...record, __outsideWorkspace: true } : record
    const evaluation = (context.isPlanMode?.() ? planModeRestriction(name) : null)
      ?? context.policy?.evaluate(name, policyRecord)
      ?? (context.approvalMode ? { decision: approvalForTool(name, policyRecord, context.approvalMode), risk: "medium" as const, reason: `${context.approvalMode} approval mode` } : null)
    let allowOutsideWorkspace = context.policy?.mode === "full-access" || context.approvalMode === "full-access"
    let approvedAfterPathCheck = false
    if (evaluation) {
      context.onPolicyDecision?.(name, evaluation)
      if (evaluation.decision === "deny") return { ok: false, output: `Permission denied: ${evaluation.reason}` }
      if (evaluation.decision === "ask") {
        const request = approvalRequest(name, record, evaluation)
        const choice = context.approveTool
          ? await context.approveTool(request)
          : LEGACY_SHELL_APPROVAL_TOOLS.has(name)
            ? await context.approveShell(String(record.command ?? ""))
            : undefined
        if (!approved(choice)) return { ok: false, output: `${name} was not approved` }
        approvedAfterPathCheck = true
        if (typeof choice === "string") await context.policy?.remember(choice, name, record)
        if (outsideWorkspace) allowOutsideWorkspace = true
      }
    }
    if (!allowOutsideWorkspace && (!pathsValidated || approvedAfterPathCheck)) await assertRealPathsInside(context.workspace, requestedPaths)
    const callContext = allowOutsideWorkspace ? { ...context, allowOutsideWorkspace: true } : context
    if (DIRECT_WRITE_TOOLS.has(name) && typeof record.path === "string") await context.beforeFileWrite?.(name, record.path)
    if (context.onPathAccess && typeof args === "object" && args !== null) {
      const values = args as Record<string, unknown>
      const paths = [
        ...(typeof values.path === "string" ? [values.path] : []),
        ...(Array.isArray(values.include) ? values.include.filter((item): item is string => typeof item === "string") : []),
      ]
      for (const requestedPath of new Set(paths)) await context.onPathAccess(requestedPath)
    }
    const startedAt = Date.now()
    const result = await tool.execute(args, callContext)
    return { ...result, presentation: result.presentation ?? createToolPresentation(name, args, result, Date.now() - startedAt) }
  } catch (error) {
    if (context.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error
    return { ok: false, output: error instanceof Error ? error.message : String(error) }
  }
}
