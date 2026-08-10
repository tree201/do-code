import assert from "node:assert/strict"
import test from "node:test"
import { configuredModelTimeout, isRetryableModelRequestError, isRetryableModelStatus, retryAfterMilliseconds } from "../src/model-retry.js"
import { consumeSse } from "../src/model-streaming.js"
import { parseOpenAIResponse } from "../src/model-openai-parsing.js"
import { createChatModel } from "../src/model.js"
import { OpenAIStreamAccumulator } from "../src/model-openai-stream.js"

test("model retry policy classifies transient failures and respects timeout overrides", () => {
  assert.equal(isRetryableModelStatus(429), true)
  assert.equal(isRetryableModelStatus(503), true)
  assert.equal(isRetryableModelStatus(400), false)
  assert.equal(isRetryableModelRequestError(Object.assign(new Error("connection reset"), { code: "ECONNRESET" })), true)
  assert.equal(isRetryableModelRequestError(new DOMException("aborted", "AbortError")), false)
  assert.equal(configuredModelTimeout(42, "DO_CODE_TEST_TIMEOUT", 100), 42)
})

test("model retry policy parses Retry-After seconds and HTTP dates", () => {
  const seconds = new Response(null, { headers: { "retry-after": "2.5" } })
  assert.equal(retryAfterMilliseconds(seconds), 2500)
  const invalid = new Response(null, { headers: { "retry-after": "invalid" } })
  assert.equal(retryAfterMilliseconds(invalid), undefined)
})

test("model streaming joins multiline SSE events and ignores DONE", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      controller.enqueue(encoder.encode("data: {\"part\":\"one\"}\n\ndata: {\"part\":"))
      controller.enqueue(encoder.encode("\"two\"}\n\ndata: [DONE]\n\n"))
      controller.close()
    },
  })
  const events: string[] = []
  await consumeSse(body, (data) => events.push(data), 1000)
  assert.deepEqual(events, ['{"part":"one"}', '{"part":"two"}'])
})

test("OpenAI response parsing preserves content, reasoning, tools, and usage", () => {
  const reply = parseOpenAIResponse({ choices: [{ message: { content: "answer", reasoning_content: "thought", tool_calls: [] }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 1 } } })
  assert.deepEqual(reply, { content: "answer", reasoningContent: "thought", toolCalls: [], finishReason: "stop", usage: { inputTokens: 3, outputTokens: 2, cachedTokens: 1 } })
  assert.throws(() => parseOpenAIResponse({ error: { message: "provider failed" } }), /provider failed/)
})

test("model factory selects the configured protocol adapter", () => {
  const base = { source: "config" as const, sourceLabel: "test", preset: "test/model", provider: "test", apiKey: "key", baseUrl: "https://example.com", modelId: "model" }
  assert.equal(createChatModel({ ...base, protocol: "openai-compatible" }).constructor.name, "OpenAICompatibleModel")
  assert.equal(createChatModel({ ...base, protocol: "anthropic" }).constructor.name, "AnthropicCompatibleModel")
  assert.equal(createChatModel({ ...base, protocol: "gemini" }).constructor.name, "GeminiCompatibleModel")
})

test("OpenAI stream accumulator merges deltas and orders tool calls", () => {
  const accumulator = new OpenAIStreamAccumulator()
  assert.throws(() => accumulator.consume("not-json"), SyntaxError)
  accumulator.consume(JSON.stringify({ choices: [{ delta: { content: "a", reasoning_content: "r", tool_calls: [{ index: 1, id: "id", function: { name: "tool", arguments: "{" } }] } }] }))
  accumulator.consume(JSON.stringify({ choices: [{ delta: { content: "b", tool_calls: [{ index: 1, function: { arguments: "}" } }, { index: 0, id: "first", function: { name: "first", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }))
  assert.deepEqual(accumulator.result(), { content: "ab", reasoningContent: "r", finishReason: "tool_calls", toolCalls: [
    { id: "first", type: "function", function: { name: "first", arguments: "{}" } },
    { id: "id", type: "function", function: { name: "tool", arguments: "{}" } },
  ] })
})
