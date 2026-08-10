import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import type { SandboxNetworkMode } from "../src/config.js"
import { BackgroundProcessManager } from "../src/background-processes.js"
import { executeTool } from "../src/tools.js"

async function waitForBackgroundJob(manager: BackgroundProcessManager, id: string, pruned = false) {
  for (let attempt = 0; attempt < 250; attempt++) {
    const status = await manager.status(id, 10, 20)
    if (pruned ? !status.ok : status.ok && JSON.parse(status.output).status === "finished") return
  }
  assert.fail(`Background job ${id} did not reach ${pruned ? "pruned" : "finished"} state`)
}

test("shell streams stdout and stderr while preserving the final output", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-shell-stream-"))
  const chunks: string[] = []
  const result = await executeTool(
    "shell",
    { command: "printf 'first\\n'; printf 'second\\n' >&2" },
    { workspace, approveShell: async () => true, onToolOutput: (chunk) => chunks.push(chunk) },
  )

  assert.equal(result.ok, true)
  assert.match(chunks.join(""), /first/)
  assert.match(chunks.join(""), /second/)
  assert.match(result.output, /first/)
  assert.match(result.output, /second/)
})

test("shell tool forwards the command's least required network mode", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-shell-network-"))
  const requested: SandboxNetworkMode[] = []
  const context = {
    workspace,
    approveShell: async () => true,
    runShell: async (_command: string, _timeoutMs: number, _onOutput?: (chunk: string) => void, _signal?: AbortSignal, network: SandboxNetworkMode = "none") => {
      requested.push(network)
      return { ok: true, output: "ok" }
    },
  }
  await executeTool("shell", { command: "npm test" }, context)
  await executeTool("shell", { command: "npm run dev" }, context)
  await executeTool("shell", { command: "npm install" }, context)
  assert.deepEqual(requested, ["none", "local", "full"])
})

test("custom shell runners cannot bypass the final output limit", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-shell-bounded-"))
  const result = await executeTool("shell", { command: "large" }, {
    workspace,
    approveShell: async () => true,
    runShell: async () => ({ ok: true, output: `HEAD${"x".repeat(50_000)}TAIL` }),
  })
  assert.ok(result.output.length < 41_000)
  assert.match(result.output, /^HEAD/)
  assert.match(result.output, /TAIL$/)
  assert.match(result.output, /characters omitted/)
})

test("background shell tools start, inspect, and stop jobs", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-background-"))
  const context = { workspace, approveShell: async () => true }
  const started = await executeTool("shell_start", { command: "printf ready; sleep 5" }, context)
  assert.equal(started.ok, true)
  const id = (JSON.parse(started.output) as { id: string }).id
  await new Promise((resolve) => setTimeout(resolve, 40))
  const status = await executeTool("shell_status", { job_id: id }, context)
  assert.match(status.output, /ready/)
  const stopped = await executeTool("shell_stop", { job_id: id }, context)
  assert.equal(stopped.ok, true)
})

test("background shell jobs accept session-scoped input", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-bg-input-"))
  const context = { workspace, approveShell: async () => true }
  const started = await executeTool("shell_start", { command: "read value; printf 'received:%s' \"$value\"" }, context)
  const id = JSON.parse(started.output).id as string
  assert.equal((await executeTool("shell_send", { job_id: id, input: "hello" }, context)).ok, true)
  const status = await executeTool("shell_status", { job_id: id, delay_ms: 50 }, context)
  assert.match(status.output, /received:hello/)
})

test("background process manager retains only the newest completed jobs", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-bg-retention-"))
  const manager = new BackgroundProcessManager(2)
  const ids: string[] = []
  for (let index = 0; index < 3; index++) {
    const started = manager.start(`job ${index}`, { executable: process.execPath, args: ["-e", ""], cwd: workspace, env: process.env })
    ids.push(started.id)
    await waitForBackgroundJob(manager, started.id)
  }
  assert.equal((await manager.status(ids[0])).ok, false)
  assert.equal((await manager.status(ids[1])).ok, true)
  assert.equal((await manager.status(ids[2])).ok, true)
})

test("background process retention never evicts running jobs", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-bg-running-"))
  const manager = new BackgroundProcessManager(0)
  const running = manager.start("running", { executable: process.execPath, args: ["-e", "setTimeout(() => {}, 5000)"], cwd: workspace, env: process.env })
  const completed = manager.start("completed", { executable: process.execPath, args: ["-e", ""], cwd: workspace, env: process.env })
  await waitForBackgroundJob(manager, completed.id, true)
  assert.equal((await manager.status(running.id)).ok, true)
  manager.close()
})

test("PTY shell jobs support terminal input, status, resize, and stop", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-pty-input-"))
  const context = { workspace, approveShell: async () => true, approvalMode: "full-access" as const }
  const started = await executeTool("shell_pty_start", { command: "read value; printf 'pty:%s\\n' \"$value\"; sleep 5", columns: 80, rows: 20 }, context)
  assert.equal(started.ok, true, started.output)
  const id = (JSON.parse(started.output) as { id: string }).id
  assert.match(id, /^pty_/)
  assert.equal((await executeTool("shell_resize", { job_id: id, columns: 100, rows: 25 }, context)).ok, true)
  assert.equal((await executeTool("shell_send", { job_id: id, input: "hello" }, context)).ok, true)
  const status = await executeTool("shell_status", { job_id: id, delay_ms: 80 }, context)
  assert.match(status.output, /"mode": "pty"/)
  assert.match(status.output, /pty:hello/)
  assert.equal((await executeTool("shell_stop", { job_id: id }, context)).ok, true)
})
