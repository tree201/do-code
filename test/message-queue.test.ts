import assert from "node:assert/strict"
import test from "node:test"
import { enqueueMessage, takeLastMessage, takeNextMessage } from "../src/ui/message-queue.js"

test("message queue trims input and drains in FIFO order", () => {
  const queue = enqueueMessage(enqueueMessage([], " first "), "second")
  assert.deepEqual(queue, ["first", "second"])
  const first = takeNextMessage(queue)
  assert.equal(first.message, "first")
  assert.deepEqual(first.queue, ["second"])
})

test("message queue lets the newest pending prompt return to the editor", () => {
  const result = takeLastMessage(["first", "second"])
  assert.equal(result.message, "second")
  assert.deepEqual(result.queue, ["first"])
  assert.deepEqual(enqueueMessage(["first"], "   "), ["first"])
})
