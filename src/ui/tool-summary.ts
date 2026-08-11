import type { DoCodeLanguage } from "../config.js"
import type { ToolPresentation } from "../protocol.js"
import { t } from "./i18n.js"

export type ToolSummaryItem = {
  name: string
  ok: boolean
  output: string
  args?: unknown
  presentation?: ToolPresentation
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

function textArg(args: unknown, key: string) {
  const value = record(args)[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function stringArgs(args: unknown, key: string) {
  const value = record(args)[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : []
}

function shortPath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "")
  const parts = normalized.split("/").filter(Boolean)
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : normalized || "."
}

function fileTargets(item: ToolSummaryItem) {
  if (item.name === "read_many_files") return stringArgs(item.args, "include").map(shortPath)
  if (!["read_file", "write_file", "edit_file", "apply_patch"].includes(item.name)) return []
  const target = textArg(item.args, "path")
  return target ? [shortPath(target)] : []
}

function quoted(value: string) {
  return value.length > 38 ? `“${value.slice(0, 37)}…”` : `“${value}”`
}

function previewTargets(values: string[], language: DoCodeLanguage) {
  const unique = [...new Set(values)]
  const shown = unique.slice(0, 3)
  return t(language, "{targets}{more}", {
    targets: shown.join(language === "zh" ? "、" : ", "),
    more: unique.length > shown.length ? t(language, " +{count} more", { count: language === "zh" ? unique.length : unique.length - shown.length }) : "",
  })
}

function shellCommand(item: ToolSummaryItem) {
  return textArg(item.args, "command")
}

function actionForGroup(name: string, count: number, ok: boolean, language: DoCodeLanguage) {
  const failed = !ok
  const actions: Record<string, [string, string]> = {
    read_file: ["Failed to read file", "Read file"], read_many_files: ["Failed to read files", "Read files"],
    list_directory: ["Failed to list", "Listed"], glob: ["Failed to find files", "Found files"], search: ["Search failed", "Searched"],
    write_file: ["Failed to write", "Wrote"], edit_file: ["Failed to edit", "Edited"], apply_patch: ["Failed to apply patch", "Applied patch"],
    shell: ["Command failed", "Ran command"], shell_start: ["Failed to start command", "Started command"], shell_status: ["Failed to check command", "Checked command"],
    web_search: ["Web search failed", "Searched the web"], web_fetch: ["Failed to fetch page", "Fetched page"],
    todo_write: ["Failed to update plan", "Updated plan"], enter_plan_mode: ["Failed to enter planning", "Entered planning"], exit_plan_mode: ["Failed to submit plan", "Reviewed plan"],
    delegate_task: ["Delegation failed", "Completed delegated task"],
  }
  const action = t(language, actions[name]?.[failed ? 0 : 1] ?? (failed ? "{name} failed" : "{name}"), { name })
  return count <= 1 ? action : t(language, "{action} {count} times", { action, count })
}

function groupDetail(name: string, items: ToolSummaryItem[], language: DoCodeLanguage) {
  const targets = items.flatMap(fileTargets)
  if (targets.length) return previewTargets(targets, language)
  const first = items[0]
  if (!first) return ""
  if (name === "search") {
    const query = textArg(first.args, "query")
    const target = textArg(first.args, "path")
    return [query ? quoted(query) : "", target ? shortPath(target) : ""].filter(Boolean).join("  ")
  }
  if (name === "glob") {
    const pattern = textArg(first.args, "pattern")
    const target = textArg(first.args, "path")
    return [pattern ? quoted(pattern) : "", target ? shortPath(target) : ""].filter(Boolean).join("  ")
  }
  if (name === "list_directory") return shortPath(textArg(first.args, "path") ?? ".")
  if (name === "shell" || name === "shell_start") {
    const command = shellCommand(first)
    return command ? (command.length > 54 ? `${command.slice(0, 53)}…` : command) : ""
  }
  if (name === "web_search") {
    const query = textArg(first.args, "query")
    return query ? quoted(query) : ""
  }
  if (name === "web_fetch") return textArg(first.args, "url") ?? ""
  return ""
}

/** Semantic summary: action first, terse target second, raw output hidden. */
export function buildToolGroupSummary(items: ToolSummaryItem[], language: DoCodeLanguage) {
  const groups = new Map<string, ToolSummaryItem[]>()
  for (const item of items) groups.set(item.name, [...(groups.get(item.name) ?? []), item])
  return [...groups.entries()].map(([name, group]) => {
    const ok = group.every((item) => item.ok)
    const action = actionForGroup(name, group.length, ok, language)
    const detail = groupDetail(name, group, language)
    return detail ? `${action}  ${detail}` : action
  }).join(language === "zh" ? "，" : ", ")
}

export function activeToolSummary(name: string, args: unknown, language: DoCodeLanguage) {
  const item: ToolSummaryItem = { name, args, ok: true, output: "" }
  const detail = groupDetail(name, [item], language)
  const actions: Record<string, string> = {
    read_file: "Reading", read_many_files: "Reading files", list_directory: "Listing", glob: "Finding files", search: "Searching",
    write_file: "Writing", edit_file: "Editing", apply_patch: "Applying patch", shell: "Running command", shell_start: "Starting command", shell_status: "Checking command",
    web_search: "Searching the web", web_fetch: "Fetching page", todo_write: "Updating plan", enter_plan_mode: "Entering planning", exit_plan_mode: "Submitting plan", delegate_task: "Delegating task",
  }
  const action = t(language, actions[name] ?? "Running {name}", { name })
  return detail ? `${action}  ${detail}` : action
}

export function toolOutputFallback(item: ToolSummaryItem) {
  const first = item.output.trim().split("\n").find(Boolean)
  return first ?? (item.ok ? "No output" : "Unknown error")
}
