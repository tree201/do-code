import { readFile, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { projectDataPath, userDataRoot, writeFileAtomic } from "./sessions.js"

export const MEMORY_INDEX_FILE = "MEMORY.md"
export const MEMORY_MAX_INDEX_LINES = 200
export const MEMORY_MAX_INDEX_CHARACTERS = 25_000
export const MEMORY_MAX_RELEVANT_DOCUMENTS = 5
export const MEMORY_MAX_RELEVANT_DOCUMENT_CHARACTERS = 1_200

export type MemoryScope = "user" | "project"
export type MemoryType = "user" | "feedback" | "project" | "reference"
export type DurableMemory = { scope: MemoryScope; type: MemoryType; name: string; description: string; content: string }
type MemoryDocument = DurableMemory & { relativePath: string }

const memoryTypes = new Set<MemoryType>(["user", "feedback", "project", "reference"])

function memoryRoot(workspace: string, scope: MemoryScope) {
  return scope === "user" ? path.join(userDataRoot(), "memories") : projectDataPath(workspace, "memories")
}

function validPath(value: string) {
  return /^(?:[a-z0-9][a-z0-9-]*\/)*[a-z0-9][a-z0-9-]{0,63}$/i.test(value)
}

function memoryFile(workspace: string, scope: MemoryScope, relativePath: string) {
  if (!validPath(relativePath)) throw new Error("Memory path must contain only 1-64 character letter, number, or hyphen segments")
  return path.join(memoryRoot(workspace, scope), `${relativePath}.md`)
}

function parseFrontmatter(content: string, scope: MemoryScope, relativePath: string): MemoryDocument | undefined {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(content)
  if (!match) return undefined
  const fields = new Map(match[1]!.split("\n").flatMap((line) => {
    const separator = line.indexOf(":")
    return separator > 0 ? [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]] : []
  }))
  const type = fields.get("type") as MemoryType | undefined
  const name = fields.get("name")
  const description = fields.get("description")
  if (!type || !memoryTypes.has(type) || !name || !description) return undefined
  return { scope, type, name, description, content: match[2]!.trim(), relativePath }
}

async function walkMemoryDocuments(root: string, scope: MemoryScope, relative = ""): Promise<MemoryDocument[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true }).catch(() => [])
  const documents = await Promise.all(entries.map(async (entry) => {
    const entryRelative = path.join(relative, entry.name)
    if (entry.isDirectory()) return await walkMemoryDocuments(root, scope, entryRelative)
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === MEMORY_INDEX_FILE) return []
    const content = await readFile(path.join(root, entryRelative), "utf8").catch(() => "")
    const document = parseFrontmatter(content, scope, entryRelative.slice(0, -3).replaceAll(path.sep, "/"))
    return document ? [document] : []
  }))
  return documents.flat()
}

async function memoryDocuments(workspace: string, scope?: MemoryScope) {
  const scopes: MemoryScope[] = scope ? [scope] : ["project", "user"]
  return (await Promise.all(scopes.map((currentScope) => walkMemoryDocuments(memoryRoot(workspace, currentScope), currentScope)))).flat()
}

export async function listDurableMemories(workspace: string, scope?: MemoryScope) {
  return (await memoryDocuments(workspace, scope)).map(({ scope: itemScope, relativePath, name }) => ({ scope: itemScope, path: relativePath, name }))
}

export async function readDurableMemory(workspace: string, scope: MemoryScope, relativePath: string): Promise<DurableMemory> {
  const content = await readFile(memoryFile(workspace, scope, relativePath), "utf8").catch(() => { throw new Error(`Memory not found: ${scope}/${relativePath}`) })
  const document = parseFrontmatter(content, scope, relativePath)
  if (!document) throw new Error(`Invalid memory format: ${scope}/${relativePath}`)
  return document
}

export async function writeDurableMemory(workspace: string, memory: DurableMemory) {
  if (!memoryTypes.has(memory.type)) throw new Error("Memory type must be user, feedback, project, or reference")
  const content = memory.content.trim()
  const description = memory.description.trim()
  if (!content || !description) throw new Error("Memory content and description cannot be empty")
  const relativePath = `${memory.type}/${memory.name}`
  const file = memoryFile(workspace, memory.scope, relativePath)
  await writeFileAtomic(file, `---\nname: ${memory.name}\ndescription: ${description}\ntype: ${memory.type}\n---\n\n${content}\n`)
  await rebuildDurableMemoryIndex(workspace, memory.scope)
}

export async function deleteDurableMemory(workspace: string, scope: MemoryScope, relativePath: string) {
  await rm(memoryFile(workspace, scope, relativePath), { force: true })
  await rebuildDurableMemoryIndex(workspace, scope)
}

export async function rebuildDurableMemoryIndex(workspace: string, scope: MemoryScope) {
  const root = memoryRoot(workspace, scope)
  const documents = await memoryDocuments(workspace, scope)
  const lines = documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath)).map((document) => `- [${document.name}](${document.relativePath}.md) — ${document.description}`)
  const index = lines.length ? `${lines.join("\n")}\n` : ""
  if (index) await writeFileAtomic(path.join(root, MEMORY_INDEX_FILE), index)
  else await rm(path.join(root, MEMORY_INDEX_FILE), { force: true })
}

async function readMemoryIndex(workspace: string, scope: MemoryScope) {
  const value = await readFile(path.join(memoryRoot(workspace, scope), MEMORY_INDEX_FILE), "utf8").catch(() => "")
  if (!value) return ""
  const lines = value.trim().split("\n").slice(0, MEMORY_MAX_INDEX_LINES)
  const trimmed = lines.join("\n").slice(0, MEMORY_MAX_INDEX_CHARACTERS)
  return trimmed.length < value.trim().length ? `${trimmed}\n\n> WARNING: MEMORY.md is truncated; keep entries concise.` : trimmed
}

const memoryProtocol = [
  "# managed memory",
  "You have persistent, file-based USER (cross-project) and PROJECT (current-project) memory. Every MEMORY.md index below is always present in context; detailed entries are recalled automatically when relevant.",
  "Build this system over time: automatically save durable user preferences, user background, project context not derivable from code or Git, and external reference pointers. Do not save code structure, Git history, temporary task state, test logs, secrets, or speculative claims.",
  "Use memory_write to save/update a record when durable information is learned; use user scope for cross-project user facts and preferences, and project scope for current-project context. Before overwriting an existing topic, use memory_read. Use memory_delete only when the user explicitly asks to forget or correct a record. Do not mention memory unless the user asks.",
  "Memories may be stale. Verify repository facts directly before acting on them. If the user asks to ignore memory, do not use recalled memory or write new memory from that request.",
].join("\n\n")

export async function durableMemoryPrompt(workspace: string) {
  const [user, project] = await Promise.all([readMemoryIndex(workspace, "user"), readMemoryIndex(workspace, "project")])
  return [memoryProtocol, `## ${memoryRoot(workspace, "user")}/MEMORY.md\n\n${user || "Your MEMORY.md is currently empty."}`, `## ${memoryRoot(workspace, "project")}/MEMORY.md\n\n${project || "Your MEMORY.md is currently empty."}`].join("\n\n")
}

function tokens(value: string) {
  return Array.from(new Set(value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2)))
}

export async function relevantDurableMemoryPrompt(workspace: string, query: string) {
  const queryTokens = tokens(query)
  if (!queryTokens.length) return ""
  const documents = await memoryDocuments(workspace)
  const selected = documents.map((document) => {
    const text = `${document.type} ${document.name} ${document.description} ${document.content}`.toLowerCase()
    return { document, score: queryTokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0) }
  }).filter(({ score }) => score > 0).sort((left, right) => right.score - left.score || Number(left.document.scope === "user") - Number(right.document.scope === "user")).slice(0, MEMORY_MAX_RELEVANT_DOCUMENTS)
  if (!selected.length) return ""
  return ["## Relevant memory", "", "Use the following memories only when directly relevant to the current request. Verify file and function claims before relying on them.", "", ...selected.flatMap(({ document }) => [`### ${document.name} (${document.relativePath}.md)`, document.description, "", document.content.slice(0, MEMORY_MAX_RELEVANT_DOCUMENT_CHARACTERS), ""])].join("\n")
}
