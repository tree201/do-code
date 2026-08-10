import { spawn } from "node:child_process"
import { BoundedOutput } from "./bounded-output.js"
import type { SandboxNetworkMode } from "./policy-contracts.js"
import type { ShellSpawnSpec, ToolContext, ToolResult } from "./tool-contracts.js"

export type ShellToolResult = ToolResult
export type CapturedCommand = { code: number | null; stdout: string; stderr: string; error?: string; truncated?: boolean }

export async function runShellCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
  okCodes: number[] = [0],
  onOutput?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<ShellToolResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"], ...(signal ? { signal } : {}) })
    const stdout = new BoundedOutput()
    const stderr = new BoundedOutput()
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs)
    child.stdout.on("data", (chunk: Buffer) => { const text = chunk.toString(); stdout.append(text); onOutput?.(text) })
    child.stderr.on("data", (chunk: Buffer) => { const text = chunk.toString(); stderr.append(text); onOutput?.(text) })
    child.on("error", (error) => { clearTimeout(timer); resolve({ ok: false, output: error.message }) })
    child.on("close", (code, signalName) => {
      clearTimeout(timer)
      const output = [stdout.value(), stderr.value()].filter(Boolean).join("\n").trim()
      resolve({ ok: code !== null && okCodes.includes(code), output: output || `Command exited with code ${code}${signalName ? ` (${signalName})` : ""}` })
    })
  })
}

export async function captureCommand(command: string, args: string[], cwd: string, timeoutMs = 120_000, maxCharacters?: number): Promise<CapturedCommand> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] })
    const stdout = new BoundedOutput(maxCharacters)
    const stderr = new BoundedOutput(maxCharacters)
    let settled = false
    let truncated = false
    const finish = (result: CapturedCommand) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result) }
    const result = (code: number | null, error?: string): CapturedCommand => ({ code, stdout: stdout.value(), stderr: stderr.value(), ...(error ? { error } : {}), ...(truncated ? { truncated: true } : {}) })
    const append = (output: BoundedOutput, chunk: Buffer) => {
      output.append(chunk)
      if (maxCharacters !== undefined && stdout.length + stderr.length >= maxCharacters && !truncated) {
        truncated = true
        child.kill("SIGTERM")
      }
    }
    const timer = setTimeout(() => { child.kill("SIGTERM"); finish(result(null, `Command timed out after ${timeoutMs}ms`)) }, timeoutMs)
    child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk))
    child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk))
    child.on("error", (error) => finish(result(null, error.message)))
    child.on("close", (code) => finish(result(code)))
  })
}

export function defaultShellSpawnSpec(context: Pick<ToolContext, "workspace" | "shellSpawnSpec">, command: string, network: SandboxNetworkMode = "none"): ShellSpawnSpec {
  return context.shellSpawnSpec?.(command, network) ?? { executable: process.env.SHELL ?? "/bin/sh", args: ["-c", command], cwd: context.workspace, env: process.env }
}
