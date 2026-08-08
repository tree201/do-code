import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import type { IPty } from "node-pty"
import type { ToolResult } from "./tools.js"

export type ShellSpawnSpec = { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }

type ProcessRecord = {
  id: string
  command: string
  mode: "pipe" | "pty"
  child?: ChildProcess
  pty?: IPty
  output: string
  startedAt: string
  finishedAt?: string
  exitCode?: number | null
  signal?: NodeJS.Signals | number | null
}

export class BackgroundProcessManager {
  private readonly processes = new Map<string, ProcessRecord>()

  start(command: string, spec: ShellSpawnSpec) {
    const id = `job_${randomUUID().slice(0, 8)}`
    const child = spawn(spec.executable, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" })
    const record: ProcessRecord = { id, command, mode: "pipe", child, output: "", startedAt: new Date().toISOString() }
    const append = (chunk: Buffer) => { record.output = (record.output + chunk.toString()).slice(-40_000) }
    child.stdout?.on("data", append)
    child.stderr?.on("data", append)
    child.on("error", (error) => { record.output = `${record.output}\n${error.message}`.trim() })
    child.on("close", (code, signal) => { record.exitCode = code; record.signal = signal; record.finishedAt = new Date().toISOString() })
    this.processes.set(id, record)
    return { id, pid: child.pid }
  }

  async startPty(command: string, spec: ShellSpawnSpec, columns = 120, rows = 30) {
    let nodePty: typeof import("node-pty")
    try { nodePty = await import("node-pty") }
    catch { throw new Error("PTY support is unavailable. Reinstall do-code with Node.js 22 so the optional node-pty dependency can be built.") }
    const id = `pty_${randomUUID().slice(0, 8)}`
    const terminal = nodePty.spawn(spec.executable, spec.args, {
      cwd: spec.cwd,
      env: Object.fromEntries(Object.entries(spec.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
      cols: Math.max(20, Math.min(columns, 500)),
      rows: Math.max(5, Math.min(rows, 200)),
      name: process.env.TERM ?? "xterm-256color",
    })
    const record: ProcessRecord = { id, command, mode: "pty", pty: terminal, output: "", startedAt: new Date().toISOString() }
    terminal.onData((chunk) => { record.output = (record.output + chunk).slice(-40_000) })
    terminal.onExit(({ exitCode, signal }) => { record.exitCode = exitCode; record.signal = signal || null; record.finishedAt = new Date().toISOString() })
    this.processes.set(id, record)
    return { id, pid: terminal.pid, mode: "pty" as const, columns, rows }
  }

  async status(id?: string, lines = 100, delayMs = 0): Promise<ToolResult> {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 5_000)))
    const records = id ? [this.processes.get(id)].filter((item): item is ProcessRecord => Boolean(item)) : [...this.processes.values()]
    if (!records.length) return { ok: false, output: id ? `Background process not found: ${id}` : "No background processes" }
    return { ok: true, output: records.map((record) => JSON.stringify({
      id: record.id,
      command: record.command,
      pid: record.child?.pid ?? record.pty?.pid,
      mode: record.mode,
      status: record.finishedAt ? "finished" : "running",
      exitCode: record.exitCode,
      signal: record.signal,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      output: record.output.split("\n").slice(-Math.max(1, Math.min(lines, 1_000))).join("\n"),
    }, null, 2)).join("\n") }
  }

  stop(id: string): ToolResult {
    const record = this.processes.get(id)
    if (!record) return { ok: false, output: `Background process not found: ${id}` }
    if (record.finishedAt) return { ok: true, output: `${id} already finished with exit code ${record.exitCode}` }
    this.terminate(record)
    return { ok: true, output: `Stopping ${id}` }
  }

  send(id: string, input: string, submit = true): ToolResult {
    const record = this.processes.get(id)
    if (!record) return { ok: false, output: `Background process not found: ${id}` }
    if (record.finishedAt) return { ok: false, output: `${id} is not accepting input` }
    if (record.mode === "pty") record.pty?.write(`${input}${submit ? "\r" : ""}`)
    else {
      if (!record.child?.stdin?.writable) return { ok: false, output: `${id} is not accepting input` }
      record.child.stdin.write(`${input}${submit ? "\n" : ""}`)
    }
    return { ok: true, output: `Sent ${Buffer.byteLength(input)} byte(s) to ${id}` }
  }

  resize(id: string, columns: number, rows: number): ToolResult {
    const record = this.processes.get(id)
    if (!record) return { ok: false, output: `Background process not found: ${id}` }
    if (record.mode !== "pty" || !record.pty) return { ok: false, output: `${id} is not a PTY process` }
    if (record.finishedAt) return { ok: false, output: `${id} has already finished` }
    record.pty.resize(Math.max(20, Math.min(columns, 500)), Math.max(5, Math.min(rows, 200)))
    return { ok: true, output: `Resized ${id} to ${columns}x${rows}` }
  }

  close() {
    for (const record of this.processes.values()) if (!record.finishedAt) this.terminate(record)
  }

  private terminate(record: ProcessRecord) {
    if (record.mode === "pty") { record.pty?.kill("SIGTERM"); return }
    if (process.platform !== "win32" && record.child?.pid) {
      try { process.kill(-record.child.pid, "SIGTERM"); return } catch { /* process may have exited */ }
    }
    record.child?.kill("SIGTERM")
  }
}
