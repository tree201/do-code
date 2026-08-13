import type { DoCodeLanguage } from "../config.js"
import type { ToolDiffLine, ToolFileChange } from "../protocol.js"
import { presentationKindForTool } from "../tool-presentation.js"
import { t } from "./i18n.js"
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

export function activityVisibleSignature(items: ToolSummaryItem[], language: DoCodeLanguage) {
  const summary = buildActivitySummary(items, language)
  return JSON.stringify({
    ok: items.every((item) => item.ok),
    title: summary.title,
    lines: summary.lines,
    diffs: summary.diffs?.map((file) => ({ path: file.path, stats: file.stats, lines: file.lines })),
  })
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

function stats(change: ToolFileChange, language: DoCodeLanguage) {
  if (change.additions === undefined && change.deletions === undefined) return change.lines === undefined ? "" : t(language, " ({count} lines)", { count: change.lines })
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
  const reads = [...new Set(items
    .filter((item) => item.name === "read_file" || item.name === "read_many_files")
    .flatMap((item) => item.presentation?.targets ?? []))]
  const lines: ActivitySummaryLine[] = []
  if (reads.length) lines.push({ text: t(language, "Read {files}{more}", {
    files: reads.slice(0, 5).map((value) => short(value)).join(language === "zh" ? "、" : ", "),
    more: reads.length > 5 ? t(language, " and {count} more", { count: language === "zh" ? reads.length : reads.length - 5 }) : "",
  }), tone: "accent" })
  for (const item of items) {
    const presentation = item.presentation
    if (item.name === "search") lines.push({ text: t(language, "Searched {query} in {target}{results}", {
      query: quoted(presentation?.query ?? ""),
      target: short(presentation?.targets?.[0] ?? "."),
      results: presentation?.resultCount !== undefined ? t(language, " · {count} results", { count: presentation.resultCount }) : "",
    }) })
    if (item.name === "glob") lines.push({ text: t(language, "Found {query} · {count} files", { query: quoted(presentation?.query ?? ""), count: presentation?.resultCount ?? 0 }) })
    if (item.name === "list_directory") lines.push({ text: t(language, "Listed {target} · {count} entries", { target: short(presentation?.targets?.[0] ?? "."), count: presentation?.resultCount ?? 0 }) })
  }
  const unique = lines.filter((line, index, all) => all.findIndex((candidate) => candidate.text === line.text) === index)
  return { title: t(language, ok ? "Explored" : "Exploration failed"), lines: unique.slice(0, 6) }
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
    ? t(language, "Edited {count} file{plural}{stats}", { count, plural: count === 1 ? "" : "s", stats: totalStats })
    : t(language, "Edit failed")
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
      stats: stats(change, language),
      ...(change.additions === undefined ? {} : { additions: change.additions }),
      ...(change.deletions === undefined ? {} : { deletions: change.deletions }),
      lines: available,
      omitted: 0,
    }
  })
  return { title, lines, ...(diffs.length ? { diffs } : {}) }
}

function commandSummary(item: ToolSummaryItem, language: DoCodeLanguage): ActivitySummary {
  const presentation = item.presentation
  const command = short(presentation?.command ?? t(language, "command"), 120)
  const duration = presentation?.durationMs !== undefined ? `${(presentation.durationMs / 1000).toFixed(presentation.durationMs < 10_000 ? 2 : 1)}s` : ""
  const title = t(language, item.ok ? "Ran {command}" : "{command} failed", { command })
  const lines: ActivitySummaryLine[] = (presentation?.excerpt ?? []).slice(0, 4).map((text) => ({ text: short(text, 160), tone: item.ok ? "muted" : "danger" }))
  if (presentation?.hiddenLines) lines.unshift({ text: t(language, "… {count} lines hidden", { count: presentation.hiddenLines }), tone: "muted" })
  if (duration) lines.push({ text: t(language, "Duration {duration}", { duration }), tone: "muted" })
  return { title, lines }
}

function backgroundSummary(item: ToolSummaryItem, language: DoCodeLanguage): ActivitySummary {
  const presentation = item.presentation
  const command = presentation?.command ? ` ${short(presentation.command, 100)}` : ""
  const job = presentation?.jobId ? ` · ${presentation.jobId}` : ""
  const actions: Record<string, string> = {
    shell_start: "Started background command{command}",
    shell_pty_start: "Started interactive command{command}",
    shell_status: "Checked background task",
    shell_stop: "Stopped background task",
    shell_send: "Sent input to background task",
    shell_resize: "Resized terminal",
  }
  const base = t(language, actions[item.name] ?? item.name, { command })
  return { title: t(language, item.ok ? "{base}{job}" : "{base} failed{job}", { base, job }), lines: (presentation?.excerpt ?? []).slice(-3).map((text) => ({ text, tone: "muted" })) }
}

function buildActivitySummaryBase(items: ToolSummaryItem[], language: DoCodeLanguage): ActivitySummary {
  const first = items[0]
  if (!first) return { title: t(language, "Tool activity"), lines: [] }
  const ok = items.every((item) => item.ok)
  const kind = first.presentation?.kind ?? presentationKindForTool(first.name)
  if (kind === "explore") return exploreSummary(items, language, ok)
  if (kind === "edit") return editSummary(items, language, ok)
  if (kind === "command") return commandSummary(first, language)
  if (kind === "background-command") return backgroundSummary(first, language)
  if (kind === "web") {
    const detail = first.presentation?.query ? quoted(first.presentation.query) : short(first.presentation?.targets?.[0] ?? "")
    return { title: t(language, first.name === "web_search" ? "Searched the web {detail}" : "Fetched page {detail}", { detail }), lines: [] }
  }
  if (kind === "plan") {
    if (first.name === "enter_plan_mode") return { title: t(language, "Entered read-only planning"), lines: [] }
    if (first.name === "exit_plan_mode") return { title: t(language, "Plan published"), lines: [] }
    if (first.name === "todo_write") {
      if (!first.ok) return { title: t(language, "Failed to update task progress"), lines: [] }
      const blocked = first.output.split("\n").filter((line) => line.trimStart().startsWith("!")).length
      if (blocked) return { title: t(language, "Tasks blocked · {count}", { count: blocked }), lines: [] }
      return { title: t(language, "Task progress updated"), lines: [] }
    }
    return { title: t(language, "Read task progress"), lines: [] }
  }
  if (kind === "delegate") return { title: t(language, "Delegated {task}", { task: quoted(first.presentation?.query ?? "") }), lines: [] }
  return { title: buildToolGroupSummary(items, language), lines: [] }
}

export function buildActivitySummary(items: ToolSummaryItem[], language: DoCodeLanguage): ActivitySummary {
  const summary = buildActivitySummaryBase(items, language)
  if (items.length < 2) return summary
  const signatures = items.map((item) => JSON.stringify(buildActivitySummaryBase([item], language)))
  if (!signatures.every((signature) => signature === signatures[0])) return summary
  const suffix = t(language, " · {count} times", { count: items.length })
  return summary.lines.length
    ? { ...summary, lines: [{ ...summary.lines[0]!, text: `${summary.lines[0]!.text}${suffix}` }, ...summary.lines.slice(1)] }
    : { ...summary, title: `${summary.title}${suffix}` }
}
