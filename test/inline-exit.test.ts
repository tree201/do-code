import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { stripVTControlCharacters } from "node:util"
import * as pty from "node-pty"

test("Ctrl+C exits an empty session without printing a misleading resume command", { timeout: 20_000 }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-exit-empty-pty-"))
  const child = spawnCli(workspace)
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
  await waitForExit(child, () => raw)

  assert.equal(firstSent, true)
  assert.equal(secondSent, true)
  assert.match(raw, /Ctrl\+C/)
  assert.doesNotMatch(raw, /Resume this session:|恢复此会话：|do-code resume/)
})

test("Ctrl+C prints the resume command for a session that was persisted", { timeout: 20_000 }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-exit-persisted-pty-"))
  const child = spawnCli(workspace)
  let raw = ""
  let sessionId = ""
  let renamed = false, firstSent = false, secondSent = false
  child.onData((data) => {
    raw += data
    sessionId ||= /session_[a-z0-9_]+/.exec(raw)?.[0] ?? ""
    if (!renamed && sessionId) {
      renamed = true
      setTimeout(() => child.write("/rename persisted\r"), 150)
    }
    if (!firstSent && /Session renamed to: persisted|会话已重命名为：persisted/.test(stripVTControlCharacters(raw))) {
      firstSent = true
      setTimeout(() => child.write("\u0003"), 150)
    }
    if (!secondSent && firstSent && raw.split("Ctrl+C").length > 1) {
      secondSent = true
      setTimeout(() => child.write("\u0003"), 150)
    }
  })
  await waitForExit(child, () => raw)

  assert.equal(renamed, true)
  assert.equal(firstSent, true)
  assert.equal(secondSent, true)
  assert.match(raw, new RegExp(`(?:Resume this session:|恢复此会话：)[\\s\\S]*do-code resume ${sessionId}`))
})

function spawnCli(workspace: string) {
  return pty.spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "-C", workspace], {
    cwd: path.resolve("."), cols: 100, rows: 28, name: "xterm-256color",
    env: { ...process.env, TERM: "xterm-256color", MODEL_API_KEY: "test", MODEL_BASE_URL: "http://127.0.0.1:1/v1", MODEL_ID: "fake-model" },
  })
}

async function waitForExit(child: pty.IPty, output: () => string) {
  await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`exit PTY did not finish; tail=${JSON.stringify(output().slice(-2_000))}`)) }, 15_000)
    child.onExit(({ exitCode }) => { clearTimeout(timer); resolve(exitCode) })
  })
}
