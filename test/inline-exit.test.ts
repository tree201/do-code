import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import * as pty from "node-pty"

test("Ctrl+C requires confirmation and prints the resumable session command", { timeout: 20_000 }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-exit-pty-"))
  const child = pty.spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "-C", workspace], {
    cwd: path.resolve("."), cols: 100, rows: 28, name: "xterm-256color",
    env: { ...process.env, TERM: "xterm-256color", MODEL_API_KEY: "test", MODEL_BASE_URL: "http://127.0.0.1:1/v1", MODEL_ID: "fake-model" },
  })
  let raw = ""
  let sessionId = ""
  let firstSent = false, secondSent = false
  child.onData((data) => {
    raw += data
    sessionId ||= /session_[a-z0-9_]+/.exec(raw)?.[0] ?? ""
    if (!firstSent && sessionId) {
      firstSent = true
      setTimeout(() => child.write("\u0003"), 150)
    }
    if (!secondSent && firstSent && raw.split("Ctrl+C").length > 1) {
      secondSent = true
      setTimeout(() => child.write("\u0003"), 150)
    }
  })
  await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`exit PTY did not finish; tail=${JSON.stringify(raw.slice(-2_000))}`)) }, 15_000)
    child.onExit(({ exitCode }) => { clearTimeout(timer); resolve(exitCode) })
  })

  assert.equal(firstSent, true)
  assert.equal(secondSent, true)
  assert.match(raw, /Ctrl\+C/)
  assert.match(raw, new RegExp(`(?:Resume this session:|恢复此会话：)[\\s\\S]*do-code resume ${sessionId}`))
})
