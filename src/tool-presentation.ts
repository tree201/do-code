import type { ToolDiffLine, ToolFileChange, ToolPresentation, ToolPresentationKind } from "./protocol.js"

type ResultLike = { ok: boolean; output: string }

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, key: string) {
  const item = record(value)[key]
  return typeof item === "string" && item.trim() ? item.trim() : undefined
}

function stringValues(value: unknown, key: string) {
  const item = record(value)[key]
  return Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : []
}

export function lineCount(value: string) {
  if (!value) return 0
  return value.replace(/\n$/, "").split(/\r?\n/).length
}

function cleanOutputLines(output: string) {
  return output
    .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "")
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
}

function commandExcerpt(output: string, ok: boolean) {
  const lines = cleanOutputLines(output)
  const errorPattern = /(?:error|failed|failure|fatal|exception|not found|denied|timed out|exit code)/i
  const meaningful = ok ? lines.slice(-4) : lines.filter((line) => errorPattern.test(line)).slice(0, 4)
  const excerpt = (meaningful.length ? meaningful : lines.slice(-4)).map((line) => line.length > 180 ? `${line.slice(0, 179)}…` : line)
  return { excerpt, hiddenLines: Math.max(0, lines.length - excerpt.length) }
}

function unifiedPatchChanges(patch: string) {
  const changes = new Map<string, ToolFileChange>()
  let current: ToolFileChange | undefined
  let oldLine = 0
  let newLine = 0
  for (const line of patch.split(/\r?\n/)) {
    const header = /^\+\+\+\s+(?:b\/)?([^\t ]+)/.exec(line)
    if (header) {
      const target = header[1]
      if (target && target !== "/dev/null") {
        current = changes.get(target) ?? { path: target, additions: 0, deletions: 0, diff: [], diffLines: [] }
        changes.set(target, current)
      }
      continue
    }
    if (!current) continue
    const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      continue
    }
    if (!oldLine && !newLine) continue
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions = (current.additions ?? 0) + 1
      current.diff?.push(line)
      current.diffLines?.push({ kind: "add", text: line.slice(1), newLine })
      newLine++
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions = (current.deletions ?? 0) + 1
      current.diff?.push(line)
      current.diffLines?.push({ kind: "remove", text: line.slice(1), oldLine })
      oldLine++
    } else if (line.startsWith(" ")) {
      current.diffLines?.push({ kind: "context", text: line.slice(1), oldLine, newLine })
      oldLine++
      newLine++
    }
  }
  return [...changes.values()]
}

export function replacementDiffLines(oldText: string, newText: string, startLine?: number): ToolDiffLine[] {
  const oldLines = oldText ? oldText.replace(/\n$/, "").split(/\r?\n/) : []
  const newLines = newText ? newText.replace(/\n$/, "").split(/\r?\n/) : []
  return [
    ...oldLines.map((text, index): ToolDiffLine => ({ kind: "remove", text, ...(startLine === undefined ? {} : { oldLine: startLine + index }) })),
    ...newLines.map((text, index): ToolDiffLine => ({ kind: "add", text, ...(startLine === undefined ? {} : { newLine: startLine + index }) })),
  ]
}

export function presentationKindForTool(name: string): ToolPresentationKind {
  if (["read_file", "read_many_files", "list_directory", "glob", "search"].includes(name)) return "explore"
  if (["write_file", "edit_file", "apply_patch"].includes(name)) return "edit"
  if (name === "shell") return "command"
  if (["shell_start", "shell_pty_start", "shell_status", "shell_send", "shell_resize", "shell_stop"].includes(name)) return "background-command"
  if (["web_search", "web_fetch"].includes(name)) return "web"
  if (["todo_write", "todo_read", "enter_plan_mode", "exit_plan_mode"].includes(name)) return "plan"
  if (name === "delegate_task") return "delegate"
  if (name === "ask_user") return "interaction"
  return "generic"
}

export function activityGroupKey(name: string, callId?: string) {
  const kind = presentationKindForTool(name)
  return kind === "explore" || kind === "edit" ? kind : `${kind}:${callId ?? name}`
}

export function createToolPresentation(name: string, args: unknown, result: ResultLike, durationMs: number): ToolPresentation {
  const kind = presentationKindForTool(name)
  const presentation: ToolPresentation = { kind, ...(durationMs > 0 ? { durationMs } : {}) }
  const target = stringValue(args, "path")
  if (target) presentation.targets = [target]

  if (name === "read_many_files") presentation.targets = stringValues(args, "include")
  if (name === "search") {
    const query = stringValue(args, "query")
    if (query) presentation.query = query
  }
  if (name === "glob") {
    const pattern = stringValue(args, "pattern")
    if (pattern) presentation.query = pattern
  }
  if (name === "list_directory" || name === "glob") presentation.resultCount = result.output === "(no files)" || result.output === "(empty directory)" ? 0 : cleanOutputLines(result.output).filter((line) => !line.startsWith("... ")).length
  if (name === "search") presentation.resultCount = result.output === "(no matches)" ? 0 : cleanOutputLines(result.output).filter((line) => !line.startsWith("... ")).length

  if (result.ok && name === "write_file" && target) {
    const content = stringValue(args, "content") ?? ""
    presentation.fileChanges = [{
      path: target,
      additions: lineCount(content),
      deletions: 0,
      lines: lineCount(content),
      diffLines: replacementDiffLines("", content, 1),
    }]
  }
  if (result.ok && name === "edit_file" && target) {
    const oldText = stringValue(args, "old_text") ?? ""
    const newText = stringValue(args, "new_text") ?? ""
    presentation.fileChanges = [{
      path: target,
      additions: lineCount(newText),
      deletions: lineCount(oldText),
      diff: [...oldText.split(/\r?\n/).map((line) => `-${line}`), ...newText.split(/\r?\n/).map((line) => `+${line}`)],
      diffLines: replacementDiffLines(oldText, newText),
    }]
  }
  if (result.ok && name === "apply_patch") presentation.fileChanges = unifiedPatchChanges(stringValue(args, "patch") ?? "")
  if (kind === "edit" && !result.ok) {
    presentation.excerpt = cleanOutputLines(result.output).slice(0, 3).map((line) => line.length > 180 ? `${line.slice(0, 179)}…` : line)
  }

  if (["shell", "shell_start", "shell_pty_start"].includes(name)) {
    const command = stringValue(args, "command")
    if (command) presentation.command = command
  }
  if (name === "shell") Object.assign(presentation, commandExcerpt(result.output, result.ok))
  if (["shell_start", "shell_pty_start", "shell_status"].includes(name)) {
    try {
      const parsed = JSON.parse(result.output) as Record<string, unknown>
      if (typeof parsed.id === "string") presentation.jobId = parsed.id
      if (typeof parsed.status === "string") presentation.processStatus = parsed.status
      if (typeof parsed.command === "string") presentation.command = parsed.command
      if (typeof parsed.output === "string") Object.assign(presentation, commandExcerpt(parsed.output, parsed.exitCode === 0 || parsed.status === "running"))
    } catch { /* A failed process action may return plain text. */ }
  }
  if (["shell_status", "shell_send", "shell_resize", "shell_stop"].includes(name) && !presentation.jobId) {
    const jobId = stringValue(args, "job_id")
    if (jobId) presentation.jobId = jobId
  }

  if (name === "web_search") {
    const query = stringValue(args, "query")
    if (query) presentation.query = query
    presentation.resultCount = cleanOutputLines(result.output).filter((line) => /^\d+\.\s/.test(line)).length
  }
  if (name === "web_fetch") presentation.targets = [stringValue(args, "url") ?? ""].filter(Boolean)
  if (name === "delegate_task") {
    const task = stringValue(args, "task")
    if (task) presentation.query = task
  }
  if (name === "todo_write") {
    const items = record(args).items
    if (Array.isArray(items)) presentation.resultCount = items.length
  }
  return presentation
}
