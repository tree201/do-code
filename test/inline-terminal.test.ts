import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import HeadlessXterm from "@xterm/headless"
import * as pty from "node-pty"

test("Ctrl+T viewer restores the inline primary screen before the next edit", { timeout: 20_000 }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-viewer-pty-"))
  const terminal = new HeadlessXterm.Terminal({ cols: 110, rows: 30, scrollback: 2_000, allowProposedApi: true })
  const child = pty.spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "-C", workspace], {
    cwd: path.resolve("."), cols: 110, rows: 30, name: "xterm-256color",
    env: { ...process.env, TERM: "xterm-256color", MODEL_API_KEY: "test", MODEL_BASE_URL: "http://127.0.0.1:1/v1", MODEL_ID: "fake-model" },
  })
  let raw = ""
  let opened = false, closed = false, typed = false
  let screenBeforeTyping = ""
  let writes = Promise.resolve()
  child.onData((data) => {
    raw += data
    writes = writes.then(async () => await new Promise<void>((resolve) => terminal.write(data, resolve)))
    if (!opened && raw.includes("session_")) {
      opened = true
      setTimeout(() => child.write("\u0014"), 300)
    }
    if (!closed && raw.includes("\u001b[?1049h")) {
      closed = true
      child.resize(86, 24)
      terminal.resize(86, 24)
      setTimeout(() => child.write("\u001b[5~"), 120)
      setTimeout(() => child.write("\u0014"), 350)
    }
    if (!typed && raw.includes("\u001b[?1049l")) {
      typed = true
      setTimeout(() => {
        const lines: string[] = []
        const start = Math.max(0, terminal.buffer.active.length - terminal.rows)
        for (let row = start; row < terminal.buffer.active.length; row++) lines.push(terminal.buffer.active.getLine(row)?.translateToString(true) ?? "")
        screenBeforeTyping = lines.join("\n")
      }, 150)
      setTimeout(() => child.write("after-viewer"), 300)
      setTimeout(() => child.kill(), 900)
    }
  })
  await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`viewer PTY did not finish; tail=${JSON.stringify(raw.slice(-2_000))}`)) }, 15_000)
    child.onExit(({ exitCode }) => { clearTimeout(timer); resolve(exitCode) })
  })
  await writes
  try {
    assert.equal(opened, true)
    assert.equal(closed, true)
    assert.equal(typed, true)
    assert.match(screenBeforeTyping, /Enter a task|输入任务/, screenBeforeTyping)
    assert.match(raw, /\u001b\[\?1049h/)
    assert.match(raw, /\u001b\[\?1049l/)
    const visible: string[] = []
    const start = Math.max(0, terminal.buffer.active.length - terminal.rows)
    for (let row = start; row < terminal.buffer.active.length; row++) visible.push(terminal.buffer.active.getLine(row)?.translateToString(true) ?? "")
    const screen = visible.join("\n")
    assert.match(screen, /after-viewer/)
    assert.equal((screen.match(/after-viewer/g) ?? []).length, 1, screen)
    const inputRow = visible.findIndex((line) => line.includes("after-viewer"))
    assert.ok(inputRow > 0, screen)
    assert.ok(visible.slice(Math.max(0, inputRow - 3), inputRow).some((line) => /^─{20,}$/.test(line.trim())), screen)
    assert.ok(visible.slice(inputRow + 1, inputRow + 4).some((line) => /^─{20,}$/.test(line.trim())), screen)
  } finally {
    terminal.dispose()
  }
})

test("real inline CLI preserves one composer and complete scrollback while streaming across resizes", { timeout: 20_000 }, async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
    let index = 0
    const timer = setInterval(() => {
      if (index < 48) {
        const content = `stream-line-${String(index).padStart(2, "0")} ${"x".repeat(36)}\n`
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`)
        index++
        return
      }
      clearInterval(timer)
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 96 } })}\n\n`)
      response.end("data: [DONE]\n\n")
    }, 8)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-inline-pty-"))
  const terminal = new HeadlessXterm.Terminal({ cols: 100, rows: 28, scrollback: 2_000, allowProposedApi: true })
  const child = pty.spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "-C", workspace], {
    cwd: path.resolve("."), cols: 100, rows: 28, name: "xterm-256color",
    env: { ...process.env, TERM: "xterm-256color", MODEL_API_KEY: "test", MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`, MODEL_ID: "fake-model" },
  })
  let raw = ""
  let sent = false, resized = false, exiting = false
  let writes = Promise.resolve()
  child.onData((data) => {
    raw += data
    writes = writes.then(async () => await new Promise<void>((resolve) => terminal.write(data, resolve)))
    if (!sent && raw.includes("session_")) {
      sent = true
      setTimeout(() => child.write("produce a long answer\r"), 200)
    }
    if (!resized && raw.includes("stream-line-04")) {
      resized = true
      for (const [cols, rows] of [[76, 24], [132, 34], [88, 26], [118, 30]] as const) {
        child.resize(cols, rows)
        terminal.resize(cols, rows)
      }
    }
    if (!exiting && raw.includes("stream-line-47")) {
      exiting = true
      // The composer intentionally remains interactive during a running turn;
      // terminate the fixture after Ink has committed the final static output.
      setTimeout(() => child.kill(), 600)
    }
  })
  await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`inline CLI PTY did not exit; tail=${JSON.stringify(raw.slice(-2_000))}`)) }, 15_000)
    child.onExit(({ exitCode }) => { clearTimeout(timer); resolve(exitCode) })
  })
  await writes
  server.close()
  try {
    assert.equal(raw.includes("\u001b[?1049h"), false, "inline CLI must not enter the alternate screen buffer")
    const lines: string[] = []
    for (let row = 0; row < terminal.buffer.active.length; row++) lines.push(terminal.buffer.active.getLine(row)?.translateToString(true) ?? "")
    const scrollback = lines.join("\n")
    assert.match(scrollback, /stream-line-00/)
    assert.match(scrollback, /stream-line-47/)
    assert.doesNotMatch(scrollback, /\[<\d+;/)
    const visibleStart = Math.max(0, terminal.buffer.active.length - terminal.rows)
    const visible = lines.slice(visibleStart).join("\n")
    assert.ok((visible.match(/(?:Enter a task or @file path|输入任务或 @文件路径)/g) ?? []).length <= 1, visible)
  } finally {
    terminal.dispose()
  }
})
