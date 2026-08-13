import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { AgentConversation } from "../src/agent.js"
import { buildSystemPrompt } from "../src/agent-context.js"
import type { ChatModel } from "../src/protocol.js"
import { readTaskNote } from "../src/task-note.js"

test("reads an existing TASK.md and bounds its model context", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-task-note-"))
  await writeFile(path.join(workspace, "TASK.md"), `# Goal\n${"x".repeat(12_100)}`, "utf8")

  const note = await readTaskNote(workspace)

  assert.ok(note?.startsWith("# Goal"))
  assert.match(note ?? "", /Task note truncated/)
})

test("adds unified TASK.md guidance to the system prompt", () => {
  const prompt = buildSystemPrompt("/workspace", "", "", false, "# Goal\nFinish the feature")

  assert.match(prompt, /For every task, verify code, Git state, tests, and artifacts directly/)
  assert.match(prompt, /Do not create it for work that can be completed without a note/)
  assert.match(prompt, /# Goal\nFinish the feature/)
})

test("refreshes TASK.md state before each model request", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-task-note-refresh-"))
  await writeFile(path.join(workspace, "TASK.md"), "# Goal\nFirst task\n", "utf8")
  let calls = 0
  const model: ChatModel = {
    async complete(input) {
      calls += 1
      const system = String(input.messages[0]?.content)
      if (calls === 1) {
        assert.match(system, /First task/)
        await writeFile(path.join(workspace, "TASK.md"), "# Goal\nUpdated task\n", "utf8")
        return { content: "First response", toolCalls: [] }
      }
      assert.match(system, /Updated task/)
      return { content: "Second response", toolCalls: [] }
    },
  }
  const conversation = new AgentConversation({ workspace, model, approveShell: async () => false })

  await conversation.run("first")
  await conversation.run("second")
})
