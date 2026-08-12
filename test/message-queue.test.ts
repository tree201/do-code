import assert from "node:assert/strict"
import test from "node:test"
import { enqueueMessage, takeLastMessage, takeNextMessage } from "../src/ui/message-queue.js"

const draft = (value: string) => ({ value, nodes: [] })

test("message queue preserves structured drafts and drains in FIFO order", () => {
  const queue = enqueueMessage(enqueueMessage([], draft("first")), draft("second"))
  assert.deepEqual(queue, [draft("first"), draft("second")])
  const first = takeNextMessage(queue)
  assert.deepEqual(first.message, draft("first"))
  assert.deepEqual(first.queue, [draft("second")])
})

test("message queue lets the newest pending draft return to the editor", () => {
  const result = takeLastMessage([draft("first"), draft("second")])
  assert.deepEqual(result.message, draft("second"))
  assert.deepEqual(result.queue, [draft("first")])
  assert.deepEqual(enqueueMessage([draft("first")], draft("   ")), [draft("first")])
})

test("message queue retains inline nodes even when visible text is empty", () => {
  const pasted = { kind: "pasted-text" as const, text: "full text", lineCount: 1 }
  assert.deepEqual(enqueueMessage([], { value: "\uFFFC", nodes: [pasted] }), [{ value: "\uFFFC", nodes: [pasted] }])
})
