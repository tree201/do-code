import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { projectDataPath, writeFileAtomic } from "./sessions.js"

export const TASK_NOTE_FILE = "TASK.md"
const MAX_TASK_NOTE_CHARACTERS = 12_000

function legacyTaskNotePath(workspace: string) {
  return path.join(workspace, TASK_NOTE_FILE)
}

function taskNotePath(workspace: string) {
  return projectDataPath(workspace, TASK_NOTE_FILE)
}

async function migrateLegacyTaskNote(workspace: string) {
  const legacy = legacyTaskNotePath(workspace)
  const target = taskNotePath(workspace)
  try {
    await readFile(target)
    return
  } catch { /* target does not exist yet */ }
  try {
    const content = await readFile(legacy, "utf8")
    if (!content.trim()) return
    await mkdir(path.dirname(target), { recursive: true })
    try {
      await rename(legacy, target)
    } catch {
      await writeFileAtomic(target, content)
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return
    throw error
  }
}

export async function readTaskNote(workspace: string) {
  await migrateLegacyTaskNote(workspace)
  const file = taskNotePath(workspace)
  try {
    const content = await readFile(file, "utf8")
    if (!content.trim()) return undefined
    if (content.length <= MAX_TASK_NOTE_CHARACTERS) return content
    return `${content.slice(0, MAX_TASK_NOTE_CHARACTERS)}\n\n[Task note truncated due to length.]`
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

export async function writeTaskNote(workspace: string, content: string) {
  const file = taskNotePath(workspace)
  await writeFileAtomic(file, content)
}
