import assert from "node:assert/strict"
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

test("help uses the alternate screen without growing primary scrollback", { timeout: 20_000 }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-help-pty-"))
  const terminal = new HeadlessXterm.Terminal({ cols: 100, rows: 28, scrollback: 1_000, allowProposedApi: true })
  const child = pty.spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "-C", workspace], {
    cwd: path.resolve("."), cols: 100, rows: 28, name: "xterm-256color",
    env: { ...process.env, TERM: "xterm-256color", MODEL_API_KEY: "test", MODEL_BASE_URL: "http://127.0.0.1:1/v1", MODEL_ID: "fake-model" },
  })
  let raw = ""
  let opened = false, closed = false, typed = false
  let primaryBaseY = -1
  let screenBeforeTyping = ""
  let writes = Promise.resolve()
  child.onData((data) => {
    raw += data
    writes = writes.then(async () => await new Promise<void>((resolve) => terminal.write(data, resolve)))
    if (!opened && raw.includes("session_")) {
      opened = true
      setTimeout(() => { primaryBaseY = terminal.buffer.active.baseY; child.write("/help\r") }, 250)
    }
    if (!closed && raw.includes("\u001b[?1049h")) {
      closed = true
      setTimeout(() => child.write("\u001b"), 250)
    }
    if (!typed && raw.includes("\u001b[?1049l")) {
      typed = true
      setTimeout(() => {
        const start = Math.max(0, terminal.buffer.active.length - terminal.rows)
        const lines: string[] = []
        for (let row = start; row < terminal.buffer.active.length; row++) lines.push(terminal.buffer.active.getLine(row)?.translateToString(true) ?? "")
        screenBeforeTyping = lines.join("\n")
      }, 150)
      setTimeout(() => child.write("after-help"), 300)
      setTimeout(() => child.kill(), 900)
    }
  })
  await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`help PTY did not finish; tail=${JSON.stringify(raw.slice(-2_000))}`)) }, 15_000)
    child.onExit(({ exitCode }) => { clearTimeout(timer); resolve(exitCode) })
  })
  await writes
  try {
    assert.equal(opened, true)
    assert.equal(closed, true)
    assert.equal(typed, true)
    assert.ok(primaryBaseY >= 0)
    assert.equal(terminal.buffer.active.baseY, primaryBaseY)
    assert.match(raw, /\u001b\[\?1049h/)
    assert.match(raw, /\u001b\[\?1049l/)
    assert.match(screenBeforeTyping, /Enter a task|输入任务/, screenBeforeTyping)
    assert.match(screenBeforeTyping, /Ctrl\+H/, screenBeforeTyping)
    const screen = terminalText(terminal)
    assert.match(screen, /after-help/)
    assert.equal((screen.match(/after-help/g) ?? []).length, 1, screen)
    assert.doesNotMatch(screen, /Keyboard shortcuts and help|快捷键与操作帮助/)
  } finally {
    terminal.dispose()
  }
})
