import type { DoCodeLanguage } from "../config.js"
import type { ToolPresentation } from "../protocol.js"

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
  const separator = language === "zh" ? "、" : ", "
  return `${shown.join(separator)}${unique.length > shown.length ? language === "zh" ? ` 等 ${unique.length} 个` : ` +${unique.length - shown.length}` : ""}`
}

function shellCommand(item: ToolSummaryItem) {
  return textArg(item.args, "command")
}

function actionForGroup(name: string, count: number, ok: boolean, language: DoCodeLanguage) {
  const zh = language === "zh"
  const failed = !ok
  const actions: Record<string, [string, string]> = {
    read_file: [failed ? "读取文件失败" : "已读取文件", failed ? "Failed to read file" : "Read file"],
    read_many_files: [failed ? "读取文件失败" : "已读取文件", failed ? "Failed to read files" : "Read files"],
    list_directory: [failed ? "列出目录失败" : "已列出目录", failed ? "Failed to list" : "Listed"],
    glob: [failed ? "查找文件失败" : "已查找文件", failed ? "Failed to find files" : "Found files"],
    search: [failed ? "搜索失败" : "已搜索", failed ? "Search failed" : "Searched"],
    write_file: [failed ? "写入失败" : "已写入", failed ? "Failed to write" : "Wrote"],
    edit_file: [failed ? "修改失败" : "已修改", failed ? "Failed to edit" : "Edited"],
    apply_patch: [failed ? "应用补丁失败" : "已应用补丁", failed ? "Failed to apply patch" : "Applied patch"],
    shell: [failed ? "命令失败" : "已运行命令", failed ? "Command failed" : "Ran command"],
    shell_start: [failed ? "启动命令失败" : "已启动命令", failed ? "Failed to start command" : "Started command"],
    shell_status: [failed ? "检查命令失败" : "已检查命令", failed ? "Failed to check command" : "Checked command"],
    web_search: [failed ? "网络搜索失败" : "已完成网络搜索", failed ? "Web search failed" : "Searched the web"],
    web_fetch: [failed ? "获取网页失败" : "已获取网页", failed ? "Failed to fetch page" : "Fetched page"],
    todo_write: [failed ? "更新计划失败" : "已更新计划", failed ? "Failed to update plan" : "Updated plan"],
    enter_plan_mode: [failed ? "进入规划失败" : "已进入规划", failed ? "Failed to enter planning" : "Entered planning"],
    exit_plan_mode: [failed ? "提交计划失败" : "已审核计划", failed ? "Failed to submit plan" : "Reviewed plan"],
    delegate_task: [failed ? "委派任务失败" : "已完成委派任务", failed ? "Delegation failed" : "Completed delegated task"],
  }
  const action = actions[name]?.[zh ? 0 : 1] ?? (failed ? (zh ? `${name} 失败` : `${name} failed`) : name)
  if (count <= 1) return action
  return zh ? `${action} ${count} 次` : `${action} ${count} times`
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

/** Qwen-style semantic summary: action first, terse target second, raw output hidden. */
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
  const actions: Record<string, [string, string]> = {
    read_file: ["正在读取", "Reading"], read_many_files: ["正在读取文件", "Reading files"],
    list_directory: ["正在列出目录", "Listing"], glob: ["正在查找文件", "Finding files"], search: ["正在搜索", "Searching"],
    write_file: ["正在写入", "Writing"], edit_file: ["正在修改", "Editing"], apply_patch: ["正在应用补丁", "Applying patch"],
    shell: ["正在运行命令", "Running command"], shell_start: ["正在启动命令", "Starting command"], shell_status: ["正在检查命令", "Checking command"],
    web_search: ["正在搜索网络", "Searching the web"], web_fetch: ["正在获取网页", "Fetching page"],
    todo_write: ["正在更新计划", "Updating plan"], enter_plan_mode: ["正在进入规划", "Entering planning"], exit_plan_mode: ["正在提交计划", "Submitting plan"], delegate_task: ["正在委派任务", "Delegating task"],
  }
  const action = actions[name]?.[language === "zh" ? 0 : 1] ?? (language === "zh" ? `正在执行 ${name}` : `Running ${name}`)
  return detail ? `${action}  ${detail}` : action
}

export function toolOutputFallback(item: ToolSummaryItem) {
  const first = item.output.trim().split("\n").find(Boolean)
  return first ?? (item.ok ? "No output" : "Unknown error")
}
