import { rm } from "node:fs/promises"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

export async function cleanBuildOutput(projectRoot) {
  await rm(path.join(projectRoot, "dist"), { recursive: true, force: true })
}

async function buildAgent() {
  const projectRoot = path.resolve(import.meta.dirname, "..")
  await cleanBuildOutput(projectRoot)
  const executable = process.platform === "win32" ? "tsc.cmd" : "tsc"
  const compiler = spawn(executable, ["-p", "tsconfig.json"], {
    cwd: projectRoot,
    stdio: "inherit",
  })
  compiler.on("error", (error) => {
    console.error(error)
    process.exitCode = 1
  })
  compiler.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exitCode = code ?? 1
  })
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await buildAgent()
