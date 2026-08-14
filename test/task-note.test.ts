import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { AgentConversation } from "../src/agent.js"
import { buildSystemPrompt } from "../src/agent-context.js"
import type { ChatModel } from "../src/protocol.js"
import { readTaskNote, writeTaskNote, TASK_NOTE_FILE } from "../src/task-note.js"
import { projectDataPath } from "../src/sessions.js"

test("reads a task note from the project data directory", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-task-note-"))
  const notePath = projectDataPath(workspace, TASK_NOTE_FILE)
  await mkdir(path.dirname(notePath), { recursive: true })
  await writeFile(notePath, "# Goal\nFinish the feature", "utf8")

  const note = await readTaskNote(workspace)

  assert.equal(note, "# Goal\nFinish the feature")
})

test("truncates long task notes", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-task-note-trunc-"))
  const notePath = projectDataPath(workspace, TASK_NOTE_FILE)
  await mkdir(path.dirname(notePath), { recursive: true })
  await writeFile(notePath, `# Goal\n${"x".repeat(12_100)}`, "utf8")

  const note = await readTaskNote(workspace)

  assert.ok(note?.startsWith("# Goal"))
  assert.match(note ?? "", /Task note truncated/)
})

test("returns undefined when no task note exists", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-task-note-none-"))

  const note = await readTaskNote(workspace)

  assert.equal(note, undefined)
})

test("migrates a legacy workspace TASK.md to the project data directory", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-task-note-migrate-"))
  await writeFile(path.join(workspace, "TASK.md"), "# Goal\nMigrated note", "utf8")

  const note = await readTaskNote(workspace)

  assert.equal(note, "# Goal\nMigrated note")
  const migrated = await readFile(projectDataPath(workspace, TASK_NOTE_FILE), "utf8")
  assert.equal(migrated, "# Goal\nMigrated note")
  await assert.rejects(readFile(path.join(workspace, "TASK.md")))
})

test("does not overwrite an existing managed note with a legacy file", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-task-note-no-overwrite-"))
  const notePath = projectDataPath(workspace, TASK_NOTE_FILE)
  await mkdir(path.dirname(notePath), { recursive: true })
  await writeFile(notePath, "# Managed", "utf8")
  await writeFile(path.join(workspace, "TASK.md"), "# Legacy", "utf8")

  const note = await readTaskNote(workspace)

  assert.equal(note, "# Managed")
})

test("writeTaskNote writes to the project data directory", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-task-note-write-"))

  await writeTaskNote(workspace, "# Goal\nWritten note")

  const content = await readFile(projectDataPath(workspace, TASK_NOTE_FILE), "utf8")
  assert.equal(content, "# Goal\nWritten note")
  await assert.rejects(readFile(path.join(workspace, "TASK.md")))
})

test("adds unified task note guidance to the system prompt", () => {
  const prompt = buildSystemPrompt("/workspace", "", "", false, "# Goal\nFinish the feature")

  assert.match(prompt, /For every task, verify code, Git state, tests, and artifacts directly/)
  assert.match(prompt, /use the write_task_note tool/)
  assert.match(prompt, /Do not create it for work that can be completed without a note/)
  assert.match(prompt, /# Goal\nFinish the feature/)
})

test("refreshes task note state before each model request", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-task-note-refresh-"))
  await writeTaskNote(workspace, "# Goal\nFirst task\n")
  let calls = 0
  const model: ChatModel = {
    async complete(input) {
      calls += 1
      const system = String(input.messages[0]?.content)
      if (calls === 1) {
        assert.match(system, /First task/)
        await writeTaskNote(workspace, "# Goal\nUpdated task\n")
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
