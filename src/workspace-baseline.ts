import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type WorkspaceBaseline = {
  schemaVersion: 1
  capturedAt: string
  kind: "git" | "unavailable"
  revision: string | null
  tree: string | null
  status: string
  initialPatchSha256: string | null
  warning: string | null
}

type CommandResult = { code: number | null; stdout: string; stderr: string }

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawn("git", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = "", stderr = ""
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
    child.on("error", (error) => resolve({ code: null, stdout, stderr: error.message }))
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

async function temporaryIndex<T>(workspace: string, action: (env: NodeJS.ProcessEnv) => Promise<T>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "do-code-index-"))
  try {
    return await action({ ...process.env, GIT_INDEX_FILE: path.join(directory, "index") })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function currentTree(workspace: string, baseTree?: string | null) {
  return await temporaryIndex(workspace, async (env) => {
    const read = baseTree
      ? await git(workspace, ["read-tree", baseTree], env)
      : await git(workspace, ["read-tree", "--empty"], env)
    if (read.code !== 0) throw new Error(read.stderr.trim() || "Unable to initialize temporary Git index")
    const add = await git(workspace, ["add", "-A", "--", "."], env)
    if (add.code !== 0) throw new Error(add.stderr.trim() || "Unable to snapshot workspace")
    const tree = await git(workspace, ["write-tree"], env)
    if (tree.code !== 0) throw new Error(tree.stderr.trim() || "Unable to write workspace tree")
    return tree.stdout.trim()
  })
}

export async function captureWorkspaceBaseline(workspace: string): Promise<WorkspaceBaseline> {
  const capturedAt = new Date().toISOString()
  const inside = await git(workspace, ["rev-parse", "--is-inside-work-tree"])
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return { schemaVersion: 1, capturedAt, kind: "unavailable", revision: null, tree: null, status: "", initialPatchSha256: null, warning: "Workspace is not a Git repository; agent-only patch isolation is unavailable." }
  }
  try {
    const revisionResult = await git(workspace, ["rev-parse", "HEAD"])
    const revision = revisionResult.code === 0 ? revisionResult.stdout.trim() : null
    const status = (await git(workspace, ["status", "--short", "--untracked-files=all"])).stdout
    const initialPatch = revision ? (await git(workspace, ["diff", "HEAD", "--binary", "--no-ext-diff", "--", "."])).stdout : ""
    const tree = await currentTree(workspace, revision)
    return {
      schemaVersion: 1, capturedAt, kind: "git", revision, tree, status,
      initialPatchSha256: createHash("sha256").update(initialPatch).digest("hex"), warning: null,
    }
  } catch (error) {
    return { schemaVersion: 1, capturedAt, kind: "unavailable", revision: null, tree: null, status: "", initialPatchSha256: null, warning: error instanceof Error ? error.message : String(error) }
  }
}

export async function workspacePatchSinceBaseline(workspace: string, baseline: WorkspaceBaseline) {
  if (baseline.kind !== "git" || !baseline.tree) return null
  const finalTree = await currentTree(workspace, baseline.tree)
  const diff = await git(workspace, ["diff", "--binary", "--no-ext-diff", baseline.tree, finalTree])
  if (diff.code !== 0) throw new Error(diff.stderr.trim() || "Unable to generate agent-only workspace patch")
  return diff.stdout
}
