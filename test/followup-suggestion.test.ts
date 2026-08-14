import assert from "node:assert/strict"
import test from "node:test"
import type { ChatModel } from "../src/protocol.js"
import { generateFollowupSuggestion, validFollowupSuggestion } from "../src/ui/followup-suggestion.js"

test("filters unsafe and assistant-voiced follow-up suggestions", () => {
  assert.equal(validFollowupSuggestion("run the tests"), "run the tests")
  assert.equal(validFollowupSuggestion("当然， 我来处理"), null)
  assert.equal(validFollowupSuggestion("looks good"), null)
  assert.equal(validFollowupSuggestion("run\nthe tests"), null)
  assert.equal(validFollowupSuggestion("one"), null)
})

test("generates one short suggestion without tools", async () => {
  let receivedTools = -1
  const model: ChatModel = { async complete(input) {
    receivedTools = input.tools.length
    return { content: "run the tests", toolCalls: [] }
  } }
  const result = await generateFollowupSuggestion(model, [
    { role: "user", content: "fix the bug" },
    { role: "assistant", content: "The bug is fixed." },
  ], new AbortController().signal)
  assert.equal(result, "run the tests")
  assert.equal(receivedTools, 0)
})
