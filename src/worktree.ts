import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { projectDataPath } from "./sessions.js"

function git(args: string[], cwd: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.on("error", reject)
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(output.trim() || `git exited with ${code}`)))
  })
}

export async function createWorktree(workspace: string, requestedName?: string) {
  const root = await git(["rev-parse", "--show-toplevel"], workspace)
  const name = (requestedName || `task-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9._-]/g, "-")
  const directory = projectDataPath(root, "worktrees", name)
  await mkdir(path.dirname(directory), { recursive: true })
  await git(["worktree", "add", "--detach", directory, "HEAD"], root)
  return { root, name, directory }
}

export async function listWorktrees(workspace: string) {
  const output = await git(["worktree", "list", "--porcelain"], workspace)
  return output.split("\n\n").filter(Boolean).map((block) => Object.fromEntries(block.split("\n").map((line) => {
    const separator = line.indexOf(" ")
    return separator < 0 ? [line, true] : [line.slice(0, separator), line.slice(separator + 1)]
  })))
}
