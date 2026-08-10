import type { SavedSession } from "../sessions.js"

export type RewindMode = "both" | "chat" | "files"

export function matchSessionQuery(sessions: SavedSession[], query: string) {
  const normalized = query.trim().toLowerCase()
  const exact = sessions.find((session) => session.id === query.trim())
  if (exact) return [exact]
  return sessions.filter((session) => session.title?.toLowerCase().includes(normalized))
}

export function parseRewindMode(argument: string): RewindMode | undefined {
  const mode = argument.trim() || "both"
  return mode === "both" || mode === "chat" || mode === "files" ? mode : undefined
}

export function parseExportArguments(argument: string): { format: "md" | "json"; output?: string } | undefined {
  const parts = argument.trim().split(/\s+/).filter(Boolean)
  const format = parts[0] ?? "md"
  if (format !== "md" && format !== "json") return undefined
  return parts[1] ? { format, output: parts[1] } : { format }
}
