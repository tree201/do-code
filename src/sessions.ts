import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { contentText, type Message } from "./protocol.js"

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

export function sessionsRoot(workspace: string) {
  return path.join(workspace, ".do-code", "sessions")
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

export async function listSessions(workspace: string): Promise<SavedSession[]> {
  const root = sessionsRoot(workspace)
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
  return {
    session,
    messages: await readJsonLines<Message>(path.join(session.directory, "messages.jsonl")),
    events: await readJsonLines<unknown>(path.join(session.directory, "events.jsonl")),
  }
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
    : path.join(workspace, ".do-code", "exports", `${id}.${format}`)
  await writeFileAtomic(target, content)
  return target
}
