import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { resolveInside } from "./workspace-paths.js"

export type Checkpoint = {
  id: string
  createdAt: string
  tool: string
  path: string
  existed: boolean
  contentBlob?: string
  contentBase64?: string
  messageCount: number
}

export class CheckpointManager {
  readonly directory: string
  readonly blobDirectory: string

  constructor(readonly workspace: string, namespace = "current") {
    this.directory = path.join(workspace, ".do-code", "checkpoints", namespace.replace(/[^a-zA-Z0-9._-]/g, "_"))
    this.blobDirectory = path.join(this.directory, "blobs")
  }

  async create(tool: string, requested: string, messageCount = 0) {
    const target = resolveInside(this.workspace, requested)
    let existed = true
    let content: Buffer | undefined
    try { content = await readFile(target) } catch { existed = false }
    const contentBlob = content ? createHash("sha256").update(content).digest("hex") : undefined
    const checkpoint: Checkpoint = {
      id: `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(), tool, path: requested, existed, messageCount,
      ...(contentBlob ? { contentBlob } : {}),
    }
    await mkdir(this.directory, { recursive: true })
    if (content && contentBlob) {
      await mkdir(this.blobDirectory, { recursive: true })
      await writeFile(path.join(this.blobDirectory, contentBlob), content, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error })
    }
    await writeFile(path.join(this.directory, `${checkpoint.id}.json`), `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8")
    return checkpoint
  }

  async list() {
    let files: string[] = []
    try { files = await readdir(this.directory) } catch { return [] }
    const checkpoints: Checkpoint[] = []
    for (const file of files.filter((item) => item.endsWith(".json"))) {
      try { checkpoints.push(JSON.parse(await readFile(path.join(this.directory, file), "utf8")) as Checkpoint) } catch { /* skip corrupt metadata */ }
    }
    return checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async restore(id?: string) {
    const checkpoints = await this.list()
    const checkpoint = id ? checkpoints.find((item) => item.id === id) : checkpoints[0]
    if (!checkpoint) throw new Error(id ? `Checkpoint not found: ${id}` : "No checkpoints found")
    const target = resolveInside(this.workspace, checkpoint.path)
    if (checkpoint.existed) {
      await mkdir(path.dirname(target), { recursive: true })
      const content = checkpoint.contentBlob
        ? await readFile(path.join(this.blobDirectory, checkpoint.contentBlob))
        : Buffer.from(checkpoint.contentBase64 ?? "", "base64")
      await writeFile(target, content)
    } else {
      await unlink(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error })
    }
    return checkpoint
  }
}
