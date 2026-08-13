import { readFile } from "node:fs/promises"
import path from "node:path"

export const TASK_NOTE_FILE = "TASK.md"
const MAX_TASK_NOTE_CHARACTERS = 12_000

export async function readTaskNote(workspace: string) {
  const file = path.join(workspace, TASK_NOTE_FILE)
  try {
    const content = await readFile(file, "utf8")
    if (!content.trim()) return undefined
    if (content.length <= MAX_TASK_NOTE_CHARACTERS) return content
    return `${content.slice(0, MAX_TASK_NOTE_CHARACTERS)}\n\n[Task note truncated. Read TASK.md for the complete note.]`
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}
