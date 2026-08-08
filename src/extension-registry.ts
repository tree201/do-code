import { readdir, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type PromptExtension = {
  name: string
  description: string
  prompt: string
  source: "user" | "project"
  kind: "command" | "skill"
  file: string
}

function frontmatter(content: string) {
  if (!content.startsWith("---\n")) return { attributes: {} as Record<string, string>, body: content }
  const end = content.indexOf("\n---\n", 4)
  if (end < 0) return { attributes: {} as Record<string, string>, body: content }
  const attributes: Record<string, string> = {}
  for (const line of content.slice(4, end).split("\n")) {
    const separator = line.indexOf(":")
    if (separator > 0) attributes[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "")
  }
  return { attributes, body: content.slice(end + 5).trim() }
}

async function files(directory: string, fileName?: string) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    if (fileName) return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(directory, entry.name, fileName))
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => path.join(directory, entry.name))
  } catch { return [] }
}

async function loadEntries(directory: string, source: PromptExtension["source"], kind: PromptExtension["kind"]) {
  const result: PromptExtension[] = []
  for (const file of await files(directory, kind === "skill" ? "SKILL.md" : undefined)) {
    try {
      const content = await readFile(file, "utf8")
      const parsed = frontmatter(content)
      const fallback = kind === "skill" ? path.basename(path.dirname(file)) : path.basename(file, ".md")
      const name = (parsed.attributes.name ?? fallback).trim().replace(/\s+/g, "-")
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) || !parsed.body) continue
      result.push({ name, description: parsed.attributes.description ?? `${source === "project" ? "Project" : "User"} ${kind === "skill" ? "skill" : "command"} ${name}`, prompt: parsed.body, source, kind, file })
    } catch { /* A broken extension does not prevent the CLI from starting. */ }
  }
  return result
}

export async function loadPromptExtensions(workspace: string): Promise<PromptExtension[]> {
  const roots = [
    [path.join(os.homedir(), ".config", "do-code"), "user"],
    [path.join(workspace, ".do-code"), "project"],
  ] as const
  const all: PromptExtension[] = []
  for (const [root, source] of roots) {
    all.push(...await loadEntries(path.join(root, "commands"), source, "command"))
    all.push(...await loadEntries(path.join(root, "skills"), source, "skill"))
  }
  const resolved = new Map<string, PromptExtension>()
  for (const entry of all) resolved.set(entry.name, entry)
  return [...resolved.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export function expandPromptExtension(extension: PromptExtension, args: string) {
  const prompt = extension.prompt.replaceAll("$ARGUMENTS", args).replaceAll("{{args}}", args)
  return args && !extension.prompt.includes("$ARGUMENTS") && !extension.prompt.includes("{{args}}") ? `${prompt}\n\nUser request: ${args}` : prompt
}
