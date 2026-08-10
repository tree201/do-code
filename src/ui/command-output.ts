import { spawn } from "node:child_process"
import { BoundedOutput } from "../bounded-output.js"

export function commandOutput(command: string, args: string[], cwd: string) {
  return new Promise<string>((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    const output = new BoundedOutput()
    child.stdout.on("data", (chunk: Buffer) => { output.append(chunk) })
    child.stderr.on("data", (chunk: Buffer) => { output.append(chunk) })
    child.on("error", (error) => resolve(error.message))
    child.on("close", () => resolve(output.value().trim()))
  })
}
