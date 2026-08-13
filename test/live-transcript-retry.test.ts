import assert from "node:assert/strict"
import test from "node:test"
import type { AgentEvent } from "../src/protocol.js"
import { reduceLiveTranscript, type LiveTranscriptState } from "../src/ui/live-transcript-reducer.js"

const event = (type: AgentEvent["type"], fields: Record<string, unknown> = {}) => ({
  protocolVersion: 1,
  turnId: "turn_test",
  type,
  ...fields,
}) as AgentEvent

const initial: LiveTranscriptState = {
  liveAssistant: "partial response",
  reasoningCharacters: 42,
  activeTool: null,
  activityEpoch: 0,
  assistantCommitted: true,
}

test("stream reconnection clears failed attempt output before retrying", () => {
  const transition = reduceLiveTranscript(initial, event("model.retrying", { step: 1, attempt: 1, delayMs: 1_000 }), "en")
  assert.equal(transition.state.liveAssistant, "")
  assert.equal(transition.state.reasoningCharacters, 0)
  assert.equal(transition.state.assistantCommitted, false)
  assert.equal(transition.state.activeTool, "Retrying attempt #1 · in 1s")
})
