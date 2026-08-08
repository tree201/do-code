import type { DoCodeLanguage } from "../config.js"
import type { ToolDiffLine, ToolFileChange } from "../protocol.js"
import { presentationKindForTool } from "../tool-presentation.js"
import { buildToolGroupSummary, type ToolSummaryItem } from "./tool-summary.js"

export type ActivitySummaryLine = {
  text: string
  tone?: "muted" | "accent" | "success" | "danger"
}

export type ActivitySummary = {
  title: string
  lines: ActivitySummaryLine[]
  diffs?: ActivityDiffFile[]
}

export type ActivityDiffFile = {
  path: string
  stats: string
  additions?: number
  deletions?: number
  lines: ToolDiffLine[]
  omitted: number
}

function short(value: string, length = 110) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "")
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized
}

function quoted(value: string) {
  return value.length > 52 ? `“${value.slice(0, 51)}…”` : `“${value}”`
}

function stats(change: ToolFileChange) {
  if (change.additions === undefined && change.deletions === undefined) return change.lines === undefined ? "" : ` (${change.lines} lines)`
  return ` (+${change.additions ?? 0} -${change.deletions ?? 0})`
}

function mergedChanges(items: ToolSummaryItem[]) {
  const changes = new Map<string, ToolFileChange>()
  // Failed edits describe an attempted mutation, not a change that reached disk.
  // Older sessions may still contain fallback fileChanges for these failures, so
  // filter them here as well as at presentation creation time.
  for (const item of items) {
    if (!item.ok) continue
    for (const change of item.presentation?.fileChanges ?? []) {
    const current = changes.get(change.path)
    if (!current) changes.set(change.path, {
      ...change,
      ...(change.diff ? { diff: [...change.diff] } : {}),
      ...(change.diffLines ? { diffLines: [...change.diffLines] } : {}),
    })
    else changes.set(change.path, {
      path: change.path,
      ...(current.additions !== undefined || change.additions !== undefined ? { additions: (current.additions ?? 0) + (change.additions ?? 0) } : {}),
      ...(current.deletions !== undefined || change.deletions !== undefined ? { deletions: (current.deletions ?? 0) + (change.deletions ?? 0) } : {}),
      ...((change.lines ?? current.lines) !== undefined ? { lines: change.lines ?? current.lines } : {}),
      diff: [...(current.diff ?? []), ...(change.diff ?? [])],
      diffLines: [...(current.diffLines ?? []), ...(change.diffLines ?? [])],
    })
    }
  }
  return [...changes.values()]
}

function exploreSummary(items: ToolSummaryItem[], language: DoCodeLanguage, ok: boolean): ActivitySummary {
  const zh = language === "zh"
  const reads = [...new Set(items
    .filter((item) => item.name === "read_file" || item.name === "read_many_files")
    .flatMap((item) => item.presentation?.targets ?? []))]
  const lines: ActivitySummaryLine[] = []
  if (reads.length) lines.push({ text: zh ? `读取 ${reads.slice(0, 5).map((value) => short(value)).join("、")}${reads.length > 5 ? ` 等 ${reads.length} 个文件` : ""}` : `Read ${reads.slice(0, 5).map((value) => short(value)).join(", ")}${reads.length > 5 ? ` and ${reads.length - 5} more` : ""}`, tone: "accent" })
  for (const item of items) {
    const presentation = item.presentation
    if (item.name === "search") lines.push({ text: zh
      ? `在 ${short(presentation?.targets?.[0] ?? ".")} 中搜索 ${quoted(presentation?.query ?? "")}${presentation?.resultCount !== undefined ? ` · ${presentation.resultCount} 条结果` : ""}`
      : `Searched ${quoted(presentation?.query ?? "")} in ${short(presentation?.targets?.[0] ?? ".")}${presentation?.resultCount !== undefined ? ` · ${presentation.resultCount} results` : ""}` })
    if (item.name === "glob") lines.push({ text: zh
      ? `查找 ${quoted(presentation?.query ?? "")} · ${presentation?.resultCount ?? 0} 个文件`
      : `Found ${quoted(presentation?.query ?? "")} · ${presentation?.resultCount ?? 0} files` })
    if (item.name === "list_directory") lines.push({ text: zh
      ? `检查 ${short(presentation?.targets?.[0] ?? ".")} · ${presentation?.resultCount ?? 0} 项`
      : `Listed ${short(presentation?.targets?.[0] ?? ".")} · ${presentation?.resultCount ?? 0} entries` })
  }
  const unique = lines.filter((line, index, all) => all.findIndex((candidate) => candidate.text === line.text) === index)
  return { title: ok ? (zh ? "检查了项目" : "Explored") : (zh ? "检查项目失败" : "Exploration failed"), lines: unique.slice(0, 6) }
}

function editSummary(items: ToolSummaryItem[], language: DoCodeLanguage, ok: boolean): ActivitySummary {
  const zh = language === "zh"
  const changes = mergedChanges(items)
  const successfulItems = items.filter((item) => item.ok)
  const additions = changes.reduce((total, item) => total + (item.additions ?? 0), 0)
  const deletions = changes.reduce((total, item) => total + (item.deletions ?? 0), 0)
  const hasStats = changes.some((item) => item.additions !== undefined || item.deletions !== undefined)
  const count = changes.length || successfulItems.length
  const totalStats = hasStats ? ` (+${additions} -${deletions})` : ""
  const title = successfulItems.length > 0
    ? zh ? `修改 ${count} 个文件${totalStats}` : `Edited ${count} file${count === 1 ? "" : "s"}${totalStats}`
    : zh ? "修改文件失败" : "Edit failed"
  const lines: ActivitySummaryLine[] = []
  if (!ok) {
    const reasons = items.filter((item) => !item.ok).flatMap((item) => item.presentation?.excerpt ?? []).slice(0, 2)
    lines.push(...reasons.map((text) => ({ text: short(text, 160), tone: "danger" as const })))
  }
  const diffs: ActivityDiffFile[] = changes.map((change) => {
    const fallbackLines: ToolDiffLine[] = (change.diff ?? []).map((text) => ({
      kind: text.startsWith("+") ? "add" : text.startsWith("-") ? "remove" : "context",
      text: text.replace(/^[+-]/, ""),
    }))
    const available = change.diffLines?.length ? change.diffLines : fallbackLines
    return {
      path: short(change.path),
      stats: stats(change),
      ...(change.additions === undefined ? {} : { additions: change.additions }),
      ...(change.deletions === undefined ? {} : { deletions: change.deletions }),
      lines: available,
      omitted: 0,
    }
  })
  return { title, lines, ...(diffs.length ? { diffs } : {}) }
}

function commandSummary(item: ToolSummaryItem, language: DoCodeLanguage): ActivitySummary {
  const zh = language === "zh"
  const presentation = item.presentation
  const command = short(presentation?.command ?? "command", 120)
  const duration = presentation?.durationMs !== undefined ? `${(presentation.durationMs / 1000).toFixed(presentation.durationMs < 10_000 ? 2 : 1)}s` : ""
  const title = item.ok ? (zh ? `运行 ${command}` : `Ran ${command}`) : (zh ? `${command} 执行失败` : `${command} failed`)
  const lines: ActivitySummaryLine[] = (presentation?.excerpt ?? []).slice(0, 4).map((text) => ({ text: short(text, 160), tone: item.ok ? "muted" : "danger" }))
  if (presentation?.hiddenLines) lines.unshift({ text: zh ? `… 已折叠 ${presentation.hiddenLines} 行输出` : `… ${presentation.hiddenLines} lines hidden`, tone: "muted" })
  if (duration) lines.push({ text: zh ? `耗时 ${duration}` : `Duration ${duration}`, tone: "muted" })
  return { title, lines }
}

function backgroundSummary(item: ToolSummaryItem, language: DoCodeLanguage): ActivitySummary {
  const zh = language === "zh"
  const presentation = item.presentation
  const command = presentation?.command ? ` ${short(presentation.command, 100)}` : ""
  const job = presentation?.jobId ? ` · ${presentation.jobId}` : ""
  const actions: Record<string, [string, string]> = {
    shell_start: [`启动后台命令${command}`, `Started background command${command}`],
    shell_pty_start: [`启动交互命令${command}`, `Started interactive command${command}`],
    shell_status: ["检查后台任务", "Checked background task"],
    shell_stop: ["停止后台任务", "Stopped background task"],
    shell_send: ["向后台任务发送输入", "Sent input to background task"],
    shell_resize: ["调整终端大小", "Resized terminal"],
  }
  const base = actions[item.name]?.[zh ? 0 : 1] ?? item.name
  return { title: item.ok ? `${base}${job}` : zh ? `${base}失败${job}` : `${base} failed${job}`, lines: (presentation?.excerpt ?? []).slice(-3).map((text) => ({ text, tone: "muted" })) }
}

export function buildActivitySummary(items: ToolSummaryItem[], language: DoCodeLanguage): ActivitySummary {
  const first = items[0]
  if (!first) return { title: language === "zh" ? "工具活动" : "Tool activity", lines: [] }
  const ok = items.every((item) => item.ok)
  const kind = first.presentation?.kind ?? presentationKindForTool(first.name)
  if (kind === "explore") return exploreSummary(items, language, ok)
  if (kind === "edit") return editSummary(items, language, ok)
  if (kind === "command") return commandSummary(first, language)
  if (kind === "background-command") return backgroundSummary(first, language)
  if (kind === "web") {
    const detail = first.presentation?.query ? quoted(first.presentation.query) : short(first.presentation?.targets?.[0] ?? "")
    return { title: first.name === "web_search" ? (language === "zh" ? `搜索网页 ${detail}` : `Searched the web ${detail}`) : (language === "zh" ? `读取网页 ${detail}` : `Fetched page ${detail}`), lines: [] }
  }
  if (kind === "plan") {
    if (first.name === "enter_plan_mode") return { title: language === "zh" ? "进入只读规划" : "Entered read-only planning", lines: [] }
    if (first.name === "exit_plan_mode") return { title: language === "zh" ? "计划已完成审核" : "Plan review completed", lines: [] }
    if (first.name === "todo_write") {
      if (!first.ok) return { title: language === "zh" ? "更新任务进度失败" : "Failed to update task progress", lines: [] }
      const blocked = first.output.split("\n").filter((line) => line.trimStart().startsWith("!")).length
      if (blocked) return { title: language === "zh" ? `任务受阻 · ${blocked} 项` : `Tasks blocked · ${blocked}`, lines: [] }
      return { title: language === "zh" ? "任务进度已更新" : "Task progress updated", lines: [] }
    }
    return { title: language === "zh" ? "读取任务进度" : "Read task progress", lines: [] }
  }
  if (kind === "delegate") return { title: language === "zh" ? `委派任务 ${quoted(first.presentation?.query ?? "")}` : `Delegated ${quoted(first.presentation?.query ?? "")}`, lines: [] }
  return { title: buildToolGroupSummary(items, language), lines: [] }
}
