import type { SavedSession } from "../sessions.js"

export function filterSessions(sessions: SavedSession[], query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return sessions
  return sessions.filter((session) => [session.id, session.title, session.model]
    .some((value) => value?.toLowerCase().includes(normalized)))
}

export function sessionPickerWindowStart(selectedIndex: number, sessionCount: number, windowSize = 8) {
  const size = Math.max(1, windowSize)
  return Math.max(0, Math.min(selectedIndex - 4, sessionCount - size))
}
