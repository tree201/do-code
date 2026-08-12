import { graphemes, replaceEditorRange, type EditorState } from "./editor.js"
import type { DoCodeLanguage } from "../config.js"
import { t } from "./i18n.js"

export type CompletionItem = {
  label: string
  description: string
  insert: string
  submit?: boolean
}

export type ArgumentCompletions = Record<string, CompletionItem[]>

export type CompletionResult = {
  start: number
  end: number
  items: CompletionItem[]
}

export type WorkspaceCompletionEntry = { file: string; normalized: string; depth: number; directory: boolean }

const commandDefinitions: CompletionItem[] = [
  { label: "/help", description: "Show available commands", insert: "/help", submit: true },
  { label: "/status", description: "Show workspace, model, and session status", insert: "/status", submit: true },
  { label: "/model", description: "Show or switch model presets", insert: "/model", submit: true },
  { label: "/language", description: "View or change language", insert: "/language" },
  { label: "/extensions", description: "Show custom commands and skills", insert: "/extensions", submit: true },
  { label: "/bug", description: "Capture a bad case and create an error ID", insert: "/bug" },
  { label: "/memory", description: "Show or reload layered AGENTS.md files", insert: "/memory" },
  { label: "/rewind", description: "Rewind chat, files, or both", insert: "/rewind" },
  { label: "/stats", description: "Show token, tool, and session statistics", insert: "/stats", submit: true },
  { label: "/compact", description: "Compact the current conversation context", insert: "/compact", submit: true },
  { label: "/permissions", description: "Choose the active permission mode", insert: "/permissions", submit: true },
  { label: "/plan", description: "Enter read-only planning or start planning a goal", insert: "/plan" },
  { label: "/diff", description: "Show current Git changes", insert: "/diff", submit: true },
  { label: "/clear", description: "Clear conversation context", insert: "/clear", submit: true },
  { label: "/resume", description: "Browse and resume previous sessions", insert: "/resume", submit: true },
  { label: "/rename", description: "Rename the current session", insert: "/rename" },
  { label: "/export", description: "Export the current session", insert: "/export" },
  { label: "/auth", description: "Configure model providers and API keys", insert: "/auth", submit: true },
  { label: "/effort", description: "Show or switch reasoning effort", insert: "/effort", submit: true },
  { label: "/thinking", description: "Show or switch thinking mode", insert: "/thinking" },
  { label: "/exit", description: "Save the session and exit", insert: "/exit", submit: true },
]

export function builtinCommandCompletions(language: DoCodeLanguage = "en") {
  return commandDefinitions.map((item) => ({ ...item, description: t(language, item.description) }))
}

const INTERNAL_WORKSPACE_PATH = /(^|\/)(?:\.git|\.do-code|node_modules|dist|build|coverage)(?:\/|$)/

function visibleWorkspaceFile(file: string) {
  return !INTERNAL_WORKSPACE_PATH.test(file.replaceAll("\\", "/"))
}

function pathDepth(file: string) {
  return file.replace(/\/$/, "").split("/").length - 1
}

export function buildWorkspaceCompletionIndex(workspaceFiles: string[]): WorkspaceCompletionEntry[] {
  const visibleFiles = workspaceFiles.filter(visibleWorkspaceFile)
  const entries = new Set(visibleFiles)
  for (const file of visibleFiles) {
    const parts = file.split("/")
    for (let index = 1; index < parts.length; index++) entries.add(`${parts.slice(0, index).join("/")}/`)
  }
  return [...entries].map((file) => ({ file, normalized: file.toLowerCase(), depth: pathDepth(file), directory: file.endsWith("/") }))
}

export function completionsForEditor(editor: EditorState, workspaceFiles: string[], customCommands: CompletionItem[] = [], argumentCompletions: ArgumentCompletions = {}, language: DoCodeLanguage = "en", workspaceIndex?: WorkspaceCompletionEntry[]): CompletionResult | null {
  const before = graphemes(editor.value).slice(0, editor.cursor).join("")
  if (/^\/[^\s]*$/.test(before)) {
    const query = before.toLowerCase()
    return {
      start: 0,
      end: editor.cursor,
      items: [...builtinCommandCompletions(language), ...customCommands].filter((item) => item.label.startsWith(query)),
    }
  }

  const argumentMatch = /^(\/[^\s]+)\s+([^\s]*)$/.exec(before)
  if (argumentMatch) {
    const command = argumentMatch[1]!
    const query = argumentMatch[2]!.toLowerCase()
    const items = argumentCompletions[command]
    if (items?.length) {
      return {
        start: graphemes(`${command} `).length,
        end: editor.cursor,
        items: items.filter((item) => item.label.toLowerCase().startsWith(query)),
      }
    }
  }

  const match = /(?:^|[^A-Za-z0-9._%+-])@([^\s@]*)$/.exec(before)
  if (!match) return null
  const query = match[1] ?? ""
  const marker = before.lastIndexOf("@")
  const normalized = query.toLowerCase()
  const entries = workspaceIndex ?? buildWorkspaceCompletionIndex(workspaceFiles)
  const matches = entries
    .filter((entry) => entry.normalized.includes(normalized) && entry.normalized !== normalized)
    .sort((left, right) => {
      const leftStarts = left.normalized.startsWith(normalized) ? 0 : 1
      const rightStarts = right.normalized.startsWith(normalized) ? 0 : 1
      return leftStarts - rightStarts || left.depth - right.depth || Number(!left.directory) - Number(!right.directory) || left.file.localeCompare(right.file)
    })
    .slice(0, 30)
    .map((entry) => ({
      label: `@${entry.file}`,
      description: t(language, entry.directory ? "Continue browsing this directory" : "Add file context"),
      insert: `@${entry.file}`,
    }))
  return {
    start: graphemes(before.slice(0, marker)).length,
    end: editor.cursor,
    items: matches,
  }
}

export function applyCompletion(editor: EditorState, workspaceFiles: string[], index = 0, customCommands: CompletionItem[] = [], argumentCompletions: ArgumentCompletions = {}, language: DoCodeLanguage = "en", workspaceIndex?: WorkspaceCompletionEntry[]) {
  const completion = completionsForEditor(editor, workspaceFiles, customCommands, argumentCompletions, language, workspaceIndex)
  if (!completion?.items.length) return editor
  const selected = completion.items[((index % completion.items.length) + completion.items.length) % completion.items.length]!
  const suffix = selected.submit || selected.insert.endsWith("/") ? "" : " "
  return replaceEditorRange(editor, completion.start, completion.end, `${selected.insert}${suffix}`)
}
