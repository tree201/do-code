import assert from "node:assert/strict"
import test from "node:test"
import { buildCompactionPrompt, compactionRetention, continuationState } from "../src/context-compaction.js"
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
