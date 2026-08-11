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

test("real inline CLI separates frozen assistant text from later tool activity", { timeout: 20_000 }, async () => {
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
    if (requests === 1) {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "The source is ready.\n\n" }, finish_reason: null }] })}\n\n`)
      setTimeout(() => {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_spacing", type: "function", function: { name: "shell", arguments: JSON.stringify({ command: "printf PTY_TOOL_OK" }) } }] }, finish_reason: "tool_calls" }] })}\n\n`)
        response.end("data: [DONE]\n\n")
      }, 150)
      return
    }
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Everything passed." }, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`)
    response.end("data: [DONE]\n\n")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-tool-spacing-pty-"))
  const terminal = new HeadlessXterm.Terminal({ cols: 100, rows: 28, scrollback: 500, allowProposedApi: true })
  const child = pty.spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "-y", "-C", workspace], {
    cwd: path.resolve("."), cols: 100, rows: 28, name: "xterm-256color",
    env: { ...process.env, TERM: "xterm-256color", MODEL_API_KEY: "test", MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`, MODEL_ID: "fake-model" },
  })
  let raw = ""
  let sent = false, openedCompletion = false, exiting = false
  let writes = Promise.resolve()
  child.onData((data) => {
    raw += data
    writes = writes.then(async () => await new Promise<void>((resolve) => terminal.write(data, resolve)))
    if (!sent && raw.includes("session_")) {
      sent = true
      setTimeout(() => child.write("verify tool spacing\r"), 150)
    }
    if (!openedCompletion && raw.includes("Everything passed.")) {
      openedCompletion = true
      setTimeout(() => child.write("/rew"), 300)
    }
    if (!exiting && openedCompletion && raw.includes("/rewind")) {
      exiting = true
      setTimeout(() => child.kill(), 400)
    }
  })
  await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`tool spacing PTY did not finish; tail=${JSON.stringify(raw.slice(-2_000))}`)) }, 15_000)
    child.onExit(({ exitCode }) => { clearTimeout(timer); resolve(exitCode) })
  })
  await writes
  await new Promise<void>((resolve) => server.close(() => resolve()))
  try {
    const lines = terminalText(terminal).split("\n")
    const assistantLine = lines.findIndex((line) => line.includes("The source is ready."))
    const toolLine = lines.findIndex((line) => line.includes("printf PTY_TOOL_OK"))
    assert.ok(assistantLine >= 0 && toolLine > assistantLine, lines.join("\n"))
    assert.equal(lines[assistantLine + 1]?.trim(), "", lines.join("\n"))
    assert.equal(toolLine, assistantLine + 2, lines.join("\n"))
    const answerLine = lines.findIndex((line) => line.includes("Everything passed."))
    const completionLine = lines.findIndex((line) => line.includes("/rewind"))
    assert.ok(answerLine >= 0 && completionLine > answerLine, lines.join("\n"))
    assert.equal(lines[answerLine + 1]?.trim(), "", lines.join("\n"))
    assert.equal(lines[answerLine + 2]?.trim(), "", lines.join("\n"))
    assert.equal(completionLine, answerLine + 3, lines.join("\n"))
    assert.equal(requests, 2)
  } finally {
    terminal.dispose()
  }
})
