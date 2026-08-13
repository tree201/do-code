import assert from "node:assert/strict"
import test from "node:test"
import { buildCompactionPrompt, compactionRetention, continuationState, rollingCompactionSource } from "../src/context-compaction.js"
import type { Message } from "../src/protocol.js"

test("context compaction measures and recovers coding-task anchors", () => {
  const messages: Message[] = [
    { role: "user", content: "Fix src/auth/login.ts and run npm test. Error ID err_20260806_deadbeef." },
    { role: "assistant", content: "Changed src/auth/login.ts; npm test is still pending." },
  ]
  const prompt = buildCompactionPrompt(messages)
  assert.match(prompt, /Current goal/)
  assert.match(prompt, /src\/auth\/login\.ts/)
  const summary = "Goal: fix login. Verification is pending."
  const retention = compactionRetention(messages, summary)
  assert.ok(retention.score < 1)
  const recovered = continuationState(messages, summary)
  assert.match(recovered, /src\/auth\/login\.ts/)
  assert.match(recovered, /npm test/)
  assert.match(recovered, /err_20260806_deadbeef/)
})

test("rolling compaction summarizes only older complete turns", () => {
  const messages: Message[] = [
    { role: "user", content: "first" },
    { role: "assistant", content: null, tool_calls: [{ id: "read", type: "function", function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "read", content: "OK: first result" },
    { role: "assistant", content: "first complete" },
    { role: "user", content: "second" },
    { role: "assistant", content: "second complete" },
    { role: "user", content: "third" },
    { role: "assistant", content: "third complete" },
    { role: "user", content: "fourth" },
    { role: "assistant", content: "fourth complete" },
    { role: "user", content: "fifth" },
  ]

  const source = rollingCompactionSource(messages)

  assert.deepEqual(source?.compacted.map((message) => message.role), ["user", "assistant", "tool", "assistant"])
  assert.deepEqual(source?.retained.map((message) => content(message)), ["second", "second complete", "third", "third complete", "fourth", "fourth complete", "fifth"])
})

function content(message: Message) {
  return typeof message.content === "string" ? message.content : ""
}
