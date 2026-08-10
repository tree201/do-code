import { spawn } from "node:child_process"

export type PatchResult = { ok: boolean; output: string }

export function toolPatchPaths(patchText: string) {
  const paths = new Set<string>()
  for (const line of patchText.split(/\r?\n/)) {
    const match = /^(?:---|\+\+\+)\s+([^\t ]+)/.exec(line)
    if (!match || match[1] === "/dev/null") continue
    paths.add(match[1]!.replace(/^[ab]\//, ""))
  }
  return [...paths]
}

export async function applyToolGitPatch(workspace: string, patchText: string, signal?: AbortSignal): Promise<PatchResult> {
  return await new Promise((resolve) => {
    const child = spawn("git", ["apply", "--whitespace=nowarn", "-"], { cwd: workspace, stdio: ["pipe", "pipe", "pipe"], ...(signal ? { signal } : {}) })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.on("error", (error) => resolve({ ok: false, output: error.message }))
    child.on("close", (code) => resolve({ ok: code === 0, output: output.trim() || (code === 0 ? "Patch applied" : `git apply exited with code ${code}`) }))
    child.stdin.end(patchText)
  })
}
