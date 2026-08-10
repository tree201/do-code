import assert from "node:assert/strict"
import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { runAgentSession } from "../src/session.js"
import type { ChatModel } from "../src/protocol.js"
import type { Message } from "../src/protocol.js"
import { createInteractiveSessionStore, durableSessionEvent, sessionMessageWriteMode } from "../src/ui/interactive-session-store.js"

test("agent session trace is ordered, sequenced, and records tool lifecycle", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-session-contract-"))
  let turn = 0
  const model: ChatModel = {
    async complete() {
      turn += 1
      if (turn === 1) {
        return {
          content: null,
          toolCalls: [{
            id: "read-1",
            type: "function",
            function: { name: "read_file", arguments: JSON.stringify({ path: "missing.txt" }) },
          }],
        }
      }
      return { content: "Finished after inspection.", toolCalls: [] }
    },
  }

  const result = await runAgentSession("inspect", {
    workspace,
    model,
    approveShell: async () => false,
  })

  assert.equal(result.status, "completed")
  assert.equal(result.finalAnswer, "Finished after inspection.")
  assert.deepEqual(result.events.map((event) => event.type), [
    "step.started",
    "tool.started",
    "tool.completed",
    "step.started",
    "agent.completed",
  ])
  assert.deepEqual(result.events.map((event) => event.sequence), [1, 2, 3, 4, 5])
  assert.ok(result.events.every((event) => event.protocolVersion === 1 && Number.isFinite(Date.parse(event.createdAt))))
  const toolStarted = result.events.find((event) => event.type === "tool.started")
  assert.equal(toolStarted?.tool, "read_file")
  assert.equal(result.toolCalls, 1)
  assert.equal(result.steps, 2)
})

test("interactive session persistence appends stable history and skips transient events", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-session-store-"))
  const messages: Message[] = [{ role: "system", content: "system" }]
  const conversation = { history: () => [...messages], restore: (next: Message[]) => { messages.splice(0, messages.length, ...next) } }
  const store = await createInteractiveSessionStore({
    workspace,
    continueSession: false,
    modelConfig: { source: "config", sourceLabel: "test", preset: "test/model", provider: "test", modelId: "model", baseUrl: "https://example.com", apiKey: "hidden", reasoningEffort: "medium", effectiveReasoningEffort: "medium", thinkingMode: "auto", effectiveThinkingMode: "auto" },
    conversation: () => conversation as never,
  })
  store.recordEvent({ protocolVersion: 1, turnId: "turn", type: "message.delta", step: 1, delta: "temporary" })
  store.recordEvent({ protocolVersion: 1, turnId: "turn", type: "turn.started", input: "hello" })
  await store.save(true)
  messages.push({ role: "user", content: "hello" })
  await store.save()

  const directory = store.session().directory
  const storedMessages = (await readFile(path.join(directory, "messages.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Message)
  const storedEvents = (await readFile(path.join(directory, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { event: { type: string } })
  assert.deepEqual(storedMessages.map((message) => message.role), ["system", "user"])
  assert.deepEqual(storedEvents.map((record) => record.event.type), ["turn.started"])
})

test("session persistence detects append-only and rewritten histories by identity", () => {
  const system: Message = { role: "system", content: "system" }
  const user: Message = { role: "user", content: "hello" }
  assert.equal(sessionMessageWriteMode([system, user], [system]), "append")
  assert.equal(sessionMessageWriteMode([{ role: "system", content: "changed" }, user], [system]), "rewrite")
  assert.equal(durableSessionEvent({ protocolVersion: 1, turnId: "turn", type: "tool.delta", step: 1, callId: "call", name: "shell", delta: "x" }), false)
})
