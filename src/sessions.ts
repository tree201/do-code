import { createHash } from "node:crypto"
import { appendFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { contentText, type Message } from "./protocol.js"
import { validateImageFile } from "./image-attachments.js"

export type SavedSession = {
  id: string
  workspace: string
  model?: string
  title?: string
  createdAt?: string
  updatedAt: string
  messageCount?: number
  directory: string
}

export type LoadedSession = {
  session: SavedSession
  messages: Message[]
  events: unknown[]
}

export function projectDataRoot(workspace: string) {
  const resolved = path.resolve(workspace)
  const slug = path.basename(resolved).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 12)
  const dataRoot = process.env.DO_CODE_DATA_DIR ?? path.join(os.homedir(), ".local", "share", "do-code")
  return path.join(dataRoot, "projects", `${slug}-${hash}`)
}

export function projectDataPath(workspace: string, ...segments: string[]) {
  return path.join(projectDataRoot(workspace), ...segments)
}

export function sessionsRoot(workspace: string) {
  return projectDataPath(workspace, "sessions")
}

function legacyProjectDataRoot(workspace: string) {
  return path.join(path.resolve(workspace), ".do-code")
}

function legacySessionsRoot(workspace: string) {
  return path.join(legacyProjectDataRoot(workspace), "sessions")
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? String(error.code) : ""
}

async function migrateLegacySession(source: string, target: string) {
  try {
    await readFile(path.join(target, "session.json"))
    return false
  } catch {
    // The target is absent or incomplete; continue with migration.
  }
  try {
    await rename(source, target)
    return true
  } catch (error) {
    if (errorCode(error) !== "EXDEV") return false
  }
  const temporary = `${target}.${process.pid}.${Date.now().toString(36)}.tmp`
  await cp(source, temporary, { recursive: true })
  try {
    await rename(temporary, target)
    await rm(source, { recursive: true, force: true })
    return true
  } catch {
    await rm(temporary, { recursive: true, force: true })
    return false
  }
}

async function migrateLegacyEntry(source: string, target: string) {
  try {
    await readFile(target)
    return false
  } catch { /* target is absent */ }
  try {
    await rename(source, target)
    return true
  } catch (error) {
    if (errorCode(error) !== "EXDEV") return false
  }
  const temporary = `${target}.${process.pid}.${Date.now().toString(36)}.tmp`
  await cp(source, temporary, { recursive: true })
  try {
    await rename(temporary, target)
    await rm(source, { recursive: true, force: true })
    return true
  } catch {
    await rm(temporary, { recursive: true, force: true })
    return false
  }
}

export async function prepareProjectData(workspace: string) {
  const resolved = path.resolve(workspace)
  const root = projectDataRoot(resolved)
  await mkdir(root, { recursive: true })
  const projectFile = path.join(root, "project.json")
  await readFile(projectFile).catch(async () => {
    await writeFileAtomic(projectFile, `${JSON.stringify({ workspace: resolved }, null, 2)}\n`)
  })
  const legacyRoot = legacyProjectDataRoot(resolved)
  const entries = await readdir(legacyRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const source = path.join(legacyRoot, entry.name)
    const target = path.join(root, entry.name)
    if (entry.name === "sessions" && entry.isDirectory()) {
      await mkdir(target, { recursive: true })
      const sessions = await readdir(source, { withFileTypes: true }).catch(() => [])
      await Promise.all(sessions.filter((session) => session.isDirectory()).map(async (session) => {
        await migrateLegacySession(path.join(source, session.name), path.join(target, session.name))
      }))
      const remainingSessions = await readdir(source).catch(() => [])
      if (!remainingSessions.length) await rm(source).catch(() => undefined)
      continue
    }
    await migrateLegacyEntry(source, target)
  }
  const remaining = await readdir(legacyRoot).catch(() => [])
  if (!remaining.length) await rm(legacyRoot, { recursive: true, force: true }).catch(() => undefined)
  return root
}

export async function prepareSessionStorage(workspace: string) {
  const root = sessionsRoot(workspace)
  await prepareProjectData(workspace)
  await mkdir(root, { recursive: true })
  return root
}

export function sessionTitleFromMessages(messages: Message[]) {
  for (const message of messages) {
    if (message.role !== "user") continue
    const content = contentText(message.content).split("\n\nReferenced file context:")[0]!.trim()
    if (content && !content.startsWith("/")) return content.replace(/\s+/g, " ").slice(0, 80)
  }
  return undefined
}

async function readJsonLines<T>(file: string): Promise<T[]> {
  const value = await readFile(file, "utf8").catch(() => "")
  return value.split("\n").filter(Boolean).map((line) => JSON.parse(line) as T)
}

export async function writeFileAtomic(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  await writeFile(temporary, content)
  await rename(temporary, file)
}

export async function appendJsonLines(file: string, values: unknown[]) {
  if (!values.length) return
  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`)
}

export async function listSessions(workspace: string): Promise<SavedSession[]> {
  const root = await prepareSessionStorage(workspace)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const sessions = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const directory = path.join(root, entry.name)
    try {
      const metadata = JSON.parse(await readFile(path.join(directory, "session.json"), "utf8")) as Omit<SavedSession, "directory">
      if (metadata.title && metadata.messageCount !== undefined) return { ...metadata, directory }
      const messages = await readJsonLines<Message>(path.join(directory, "messages.jsonl"))
      return {
        ...metadata,
        title: metadata.title ?? sessionTitleFromMessages(messages) ?? entry.name,
        messageCount: metadata.messageCount ?? messages.length,
        directory,
      }
    } catch {
      return null
    }
  }))
  return sessions
    .filter((item): item is SavedSession => Boolean(item))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function searchSessions(workspace: string, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return await listSessions(workspace)
  const sessions = await listSessions(workspace)
  return sessions.filter((session) => [session.id, session.title, session.model]
    .some((value) => value?.toLowerCase().includes(normalized)))
}

export async function loadSession(workspace: string, id?: string): Promise<LoadedSession> {
  const sessions = await listSessions(workspace)
  const session = id ? sessions.find((item) => item.id === id) : sessions[0]
  if (!session) throw new Error(id ? `Session not found: ${id}` : "This project has no resumable sessions")
  const messages = await readJsonLines<Message>(path.join(session.directory, "messages.jsonl"))
  await validateSessionAttachments(session.directory, messages)
  return {
    session,
    messages,
    events: await readJsonLines<unknown>(path.join(session.directory, "events.jsonl")),
  }
}

async function validateSessionAttachments(sessionDirectory: string, messages: Message[]) {
  const references = messages.flatMap((message) => Array.isArray(message.content)
    ? message.content.filter((part) => part.type === "image").map((part) => part.path)
    : [])
  await Promise.all(references.map(async (reference) => {
    if (path.isAbsolute(reference)) throw new Error(`Invalid session attachment path: ${reference}`)
    const file = path.resolve(sessionDirectory, reference)
    const relative = path.relative(sessionDirectory, file)
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Invalid session attachment path: ${reference}`)
    try {
      await validateImageFile(file)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Image file not found:")) throw new Error(`Session attachment is missing: ${reference}`)
      throw new Error(`Invalid session attachment: ${reference}`)
    }
  }))
}

export async function renameSession(workspace: string, id: string, title: string) {
  const normalized = title.trim()
  if (!normalized) throw new Error("Session name cannot be empty")
  const loaded = await loadSession(workspace, id)
  const metadata = { ...loaded.session, title: normalized, updatedAt: new Date().toISOString() }
  const { directory: _directory, ...stored } = metadata
  await writeFileAtomic(path.join(loaded.session.directory, "session.json"), `${JSON.stringify(stored, null, 2)}\n`)
  return metadata
}

export async function deleteSession(workspace: string, id: string) {
  const loaded = await loadSession(workspace, id)
  await rm(loaded.session.directory, { recursive: true, force: true })
}

function markdownTranscript(loaded: LoadedSession) {
  const title = loaded.session.title ?? loaded.session.id
  const lines = [
    `# ${title}`,
    "",
    `- Session: \`${loaded.session.id}\``,
    `- Model: \`${loaded.session.model ?? "unknown"}\``,
    `- Workspace: \`${loaded.session.workspace}\``,
    `- Updated: ${loaded.session.updatedAt}`,
    "",
  ]
  for (const message of loaded.messages) {
    if (message.role === "system" || message.role === "tool") continue
    const content = contentText(message.content).split("\n\nReferenced file context:")[0]?.trim()
    if (!content) continue
    lines.push(message.role === "user" ? "## User" : "## do-code", "", content, "")
  }
  return `${lines.join("\n").trim()}\n`
}

export async function exportSession(workspace: string, id: string, format: "md" | "json" = "md", output?: string) {
  const loaded = await loadSession(workspace, id)
  const content = format === "json"
    ? `${JSON.stringify({ session: { ...loaded.session, directory: undefined }, messages: loaded.messages, events: loaded.events }, null, 2)}\n`
    : markdownTranscript(loaded)
  const target = output
    ? path.resolve(workspace, output)
    : path.join(projectDataRoot(workspace), "exports", `${id}.${format}`)
  await writeFileAtomic(target, content)
  return target
}
