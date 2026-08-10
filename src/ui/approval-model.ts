import type { ToolApprovalRequest } from "../policy.js"
import type { ActivityDiffFile } from "./activity-summary.js"
import type { DoCodeLanguage } from "../config.js"

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
  const zh = language === "zh"
  const target = String(request.args.path ?? "")
  const risk = zh
    ? { low: "低风险", medium: "中等风险", high: "高风险", critical: "严重风险" }[request.risk]
    : { low: "low risk", medium: "medium risk", high: "high risk", critical: "critical risk" }[request.risk]
  if (request.tool === "edit_file") return { title: zh ? `修改 ${target}` : `Edit ${target}`, question: zh ? "允许修改这个文件吗？" : "Allow this file change?", risk }
  if (request.tool === "apply_patch" || request.tool === "write_file") return { title: zh ? "修改工作区文件" : "Modify workspace files", question: zh ? "允许应用这些文件修改吗？" : "Allow these workspace changes?", risk }
  if (request.tool === "shell" || request.tool === "shell_start" || request.tool === "shell_pty_start") return { title: zh ? "运行命令" : "Run command", question: zh ? "允许运行这个命令吗？" : "Allow this command?", risk }
  if (request.tool === "web_fetch" || request.tool === "web_search") return { title: zh ? "访问网络" : "Access network", question: zh ? "允许这次网络访问吗？" : "Allow this network request?", risk }
  return { title: zh ? `运行 ${request.tool}` : `Run ${request.tool}`, question: zh ? "允许执行这个操作吗？" : "Allow this action?", risk }
}
