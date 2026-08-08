import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import test from "node:test"
import { runAgentSession } from "../src/session.js"
import type { ChatModel } from "../src/protocol.js"
import { verificationCommand } from "../src/completion-verification.js"

const run = promisify(execFile)

test("completion verification recognizes direct framework test commands after a workspace cd", () => {
  assert.equal(verificationCommand({ command: "cd /tmp/project && node --test test/*.test.js 2>&1" }), "cd /tmp/project && node --test test/*.test.js 2>&1")
  assert.equal(verificationCommand({ command: "python -m pytest -q" }), "python -m pytest -q")
})

test("agent patch excludes pre-existing dirty worktree changes and records verification", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-baseline-"))
  await run("git", ["init", "-q"], { cwd: workspace })
  await run("git", ["config", "user.email", "test@do-code.local"], { cwd: workspace })
  await run("git", ["config", "user.name", "do-code test"], { cwd: workspace })
  await writeFile(path.join(workspace, "user.txt"), "committed\n")
  await writeFile(path.join(workspace, "agent.txt"), "before\n")
  await writeFile(path.join(workspace, "package.json"), "{}\n")
  await run("git", ["add", "."], { cwd: workspace })
  await run("git", ["commit", "-qm", "baseline"], { cwd: workspace })
  await writeFile(path.join(workspace, "user.txt"), "user dirty change\n")

  let turn = 0
  const model: ChatModel = { async complete() {
    turn++
    if (turn === 1) return { content: null, toolCalls: [{ id: "edit", type: "function", function: { name: "edit_file", arguments: JSON.stringify({ path: "agent.txt", old_text: "before\n", new_text: "after\n" }) } }] }
    if (turn === 2) return { content: "Premature completion.", toolCalls: [] }
    if (turn === 3) return { content: null, toolCalls: [{ id: "test", type: "function", function: { name: "shell", arguments: JSON.stringify({ command: "npm test" }) } }] }
    return { content: "Changed and verified.", toolCalls: [] }
  } }
  const result = await runAgentSession("change agent.txt", {
    workspace, model, requireVerification: true, approveShell: async () => true,
    runShell: async () => ({ ok: true, output: "tests passed" }),
  })

  assert.equal(turn, 4)
  assert.match(result.patch, /agent\.txt/)
  assert.doesNotMatch(result.patch, /user dirty change/)
  assert.match(result.baseline?.status ?? "", /user\.txt/)
  assert.equal(result.verification?.status, "passed")
  assert.equal(result.verification?.commands[0]?.command, "npm test")
  assert.equal(await readFile(path.join(workspace, "user.txt"), "utf8"), "user dirty change\n")
})
