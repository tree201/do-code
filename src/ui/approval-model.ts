import type { ToolApprovalRequest } from "../policy.js"
import type { ActivityDiffFile } from "./activity-summary.js"
import type { DoCodeLanguage } from "../config.js"
import { t } from "./i18n.js"

export function approvalEditDiff(request: ToolApprovalRequest): ActivityDiffFile | null {
  if (request.tool !== "edit_file") return null
  const before = typeof request.args.old_text === "string" ? request.args.old_text : ""
  const after = typeof request.args.new_text === "string" ? request.args.new_text : ""
  const removed = before.split("\n").map((text) => ({ kind: "remove" as const, text }))
  const added = after.split("\n").map((text) => ({ kind: "add" as const, text }))
  return {
    path: String(request.args.path ?? ""),
    stats: ` (+${added.length} -${removed.length})`,
    additions: added.length,
    deletions: removed.length,
    lines: [...removed, ...added],
    omitted: 0,
  }
}

export function approvalLabels(request: ToolApprovalRequest, language: DoCodeLanguage) {
  const target = String(request.args.path ?? "")
  const risk = t(language, { low: "low risk", medium: "medium risk", high: "high risk", critical: "critical risk" }[request.risk])
  if (request.tool === "edit_file") return { title: t(language, "Edit {target}", { target }), question: t(language, "Allow this file change?"), risk }
  if (request.tool === "apply_patch" || request.tool === "write_file") return { title: t(language, "Modify workspace files"), question: t(language, "Allow these workspace changes?"), risk }
  if (request.tool === "shell" || request.tool === "shell_start" || request.tool === "shell_pty_start") return { title: t(language, "Run command"), question: t(language, "Allow this command?"), risk }
  if (request.tool === "web_fetch" || request.tool === "web_search") return { title: t(language, "Access network"), question: t(language, "Allow this network request?"), risk }
  return { title: t(language, "Run {tool}", { tool: request.tool }), question: t(language, "Allow this action?"), risk }
}
