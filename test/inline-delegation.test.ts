import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import HeadlessXterm from "@xterm/headless"
import * as pty from "node-pty"

function terminalText(terminal: HeadlessXterm.Terminal) {
  const lines: string[] = []
  for (let row = 0; row < terminal.buffer.active.length; row++) lines.push(terminal.buffer.active.getLine(row)?.translateToString(true) ?? "")
  return lines.join("\n")
}

test("Esc interrupts an active delegated model request and restores the composer", { timeout: 20_000 }, async () => {
  let requests = 0
  let delegatedRequestClosed = false
  let child: pty.IPty | undefined
  const server = createServer((request, response) => {
    requests++
    if (requests === 1) {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_delegate", type: "function", function: { name: "delegate_task", arguments: JSON.stringify({ task: "Inspect the workspace" }) } }] }, finish_reason: "tool_calls" }] })}\n\n`)
      response.end("data: [DONE]\n\n")
      return
    }
    const markClosed = () => { delegatedRequestClosed = true }
    request.once("aborted", markClosed)
    response.once("close", markClosed)
    setTimeout(() => child?.write("\u001b"), 250)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-delegation-pty-"))
  const terminal = new HeadlessXterm.Terminal({ cols: 100, rows: 28, scrollback: 500, allowProposedApi: true })
  child = pty.spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "-C", workspace], {
    cwd: path.resolve("."), cols: 100, rows: 28, name: "xterm-256color",
    env: { ...process.env, TERM: "xterm-256color", MODEL_API_KEY: "test", MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`, MODEL_ID: "fake-model" },
  })
  let raw = ""
  let sent = false, resumedInput = false
  let writes = Promise.resolve()
  child.onData((data) => {
    raw += data
    writes = writes.then(async () => await new Promise<void>((resolve) => terminal.write(data, resolve)))
    if (!sent && raw.includes("session_")) {
      sent = true
      setTimeout(() => child?.write("delegate then stop\r"), 150)
    }
    if (!resumedInput && raw.includes("The current task was interrupted.")) {
      resumedInput = true
      setTimeout(() => child?.write("after-delegate-abort"), 200)
      setTimeout(() => child?.kill(), 800)
    }
  })
  await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { child?.kill(); reject(new Error(`delegation PTY did not finish; tail=${JSON.stringify(raw.slice(-2_000))}`)) }, 15_000)
    child?.onExit(({ exitCode }) => { clearTimeout(timer); resolve(exitCode) })
  })
  await writes
  await new Promise<void>((resolve) => server.close(() => resolve()))
  try {
    const screen = terminalText(terminal)
    assert.equal(requests, 2)
    assert.equal(delegatedRequestClosed, true)
    assert.equal(resumedInput, true)
    assert.match(screen, /The current task was interrupted\./)
    assert.match(screen, /after-delegate-abort/)
  } finally {
    terminal.dispose()
  }
})
