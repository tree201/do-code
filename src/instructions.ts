import { access, readFile, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type InstructionSource = {
  scope: "user" | "project" | "directory"
  path: string
  label: string
  content: string
}

async function exists(target: string) {
  return await access(target).then(() => true, () => false)
}

async function readSource(file: string, scope: InstructionSource["scope"], label: string) {
  try {
    const info = await stat(file)
    if (!info.isFile()) return null
    const content = (await readFile(file, "utf8")).trim()
    return content ? { scope, path: file, label, content } satisfies InstructionSource : null
  } catch {
    return null
  }
}

function directoryChain(root: string, target: string) {
  const relative = path.relative(root, target)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return []
  const chain = [root]
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    chain.push(current)
  }
  return chain
}

async function repositoryRoot(workspace: string) {
  let current = path.resolve(workspace)
  while (true) {
    if (await exists(path.join(current, ".git"))) return current
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(workspace)
    current = parent
  }
}

function stablePathBeforeGlob(requested: string) {
  const normalized = requested.replaceAll("\\", "/")
  const wildcard = normalized.search(/[?*[]/)
  if (wildcard < 0) return requested
  const prefix = normalized.slice(0, wildcard)
  return prefix.endsWith("/") ? prefix.slice(0, -1) || "." : path.dirname(prefix) || "."
}

export class InstructionMemory {
  private sources = new Map<string, InstructionSource>()
  private visitedDirectories = new Set<string>()
  private initialized = false

  constructor(
    readonly workspace: string,
    private readonly configDirectory: string | null = process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, "do-code")
      : path.join(os.homedir(), ".config", "do-code"),
  ) {}

  private async add(file: string, scope: InstructionSource["scope"], label: string) {
    const source = await readSource(file, scope, label)
    if (!source) return false
    const previous = this.sources.get(file)
    this.sources.set(file, source)
    return previous?.content !== source.content
  }

  private async loadBase() {
    if (this.configDirectory) {
      await this.add(path.join(this.configDirectory, "AGENTS.md"), "user", "User instructions")
    }
    const workspace = path.resolve(this.workspace)
    const root = await repositoryRoot(workspace)
    for (const directory of directoryChain(root, workspace)) {
      const scope = directory === workspace ? "project" : "project"
      await this.add(path.join(directory, "AGENTS.md"), scope, path.relative(workspace, directory) || ".")
      this.visitedDirectories.add(directory)
    }
  }

  async initialize() {
    if (this.initialized) return
    await this.loadBase()
    this.initialized = true
  }

  async discover(requested: string) {
    await this.initialize()
    const workspace = path.resolve(this.workspace)
    const stable = stablePathBeforeGlob(requested)
    let target = path.resolve(workspace, stable)
    const relative = path.relative(workspace, target)
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return []
    try {
      if ((await stat(target)).isFile()) target = path.dirname(target)
    } catch {
      target = path.dirname(target)
    }
    const added: InstructionSource[] = []
    for (const directory of directoryChain(workspace, target).slice(1)) {
      if (this.visitedDirectories.has(directory)) continue
      this.visitedDirectories.add(directory)
      const file = path.join(directory, "AGENTS.md")
      if (await this.add(file, "directory", path.relative(workspace, directory))) added.push(this.sources.get(file)!)
    }
    return added
  }

  async reload() {
    const visited = [...this.visitedDirectories]
    this.sources.clear()
    this.visitedDirectories.clear()
    this.initialized = false
    await this.initialize()
    for (const directory of visited) {
      const relative = path.relative(this.workspace, directory)
      if (relative && !relative.startsWith("..")) await this.discover(relative)
    }
    return this.list()
  }

  async list() {
    await this.initialize()
    return [...this.sources.values()]
  }

  async prompt() {
    const sources = await this.list()
    const global = sources.filter((source) => source.scope === "user")
    const project = sources.filter((source) => source.scope !== "user")
    return [
      global.length ? `<global_context>\n${global.map((source) => `## ${source.path}\n${source.content}`).join("\n\n")}\n</global_context>` : "",
      project.length ? `<project_context>\n${project.map((source) => `## ${source.path}\n${source.content}`).join("\n\n")}\n</project_context>` : "",
    ].filter(Boolean).join("\n\n")
  }
}
