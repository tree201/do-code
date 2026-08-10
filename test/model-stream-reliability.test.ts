import assert from "node:assert/strict"
import { createServer } from "node:http"
import test from "node:test"
import { OpenAICompatibleModel } from "../src/model.js"

test("model retries transient fetch failures before streaming starts", async (context) => {
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    if (requests === 1) {
      response.destroy()
      return
    }
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "recovered" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Server did not expose a port")

  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "test-model",
    retry: { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 },
  })
  const result = await model.complete({ messages: [{ role: "user", content: "test" }], tools: [] })

  assert.equal(requests, 2)
  assert.equal(result.content, "recovered")
  assert.equal(model.usage.requests, 1, "usage counts one logical model request rather than transport attempts")
})

test("model makes five retries for retryable HTTP failures", async (context) => {
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(503, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: { message: "temporarily unavailable" } }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Server did not expose a port")

  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "test-model",
    retry: { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 },
  })

  await assert.rejects(
    model.complete({ messages: [{ role: "user", content: "test" }], tools: [] }),
    /temporarily unavailable/,
  )
  assert.equal(requests, 6, "one initial request plus five retries")
})

test("model retries auth_unavailable responses and reports retry attempts", async (context) => {
  let requests = 0
  const retries: Array<{ attempt: number; delayMs: number; message: string | undefined }> = []
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(401, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: { message: "auth_unavailable: no auth available" } }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Server did not expose a port")

  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "test-model",
    retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1, jitter: 0 },
  })

  await assert.rejects(
    model.complete({ messages: [{ role: "user", content: "test" }], tools: [] }, { onRetry: (attempt, delayMs, message) => retries.push({ attempt, delayMs, message }) }),
    /auth_unavailable: no auth available/,
  )
  assert.equal(requests, 3)
  assert.deepEqual(retries.map((retry) => retry.attempt), [1, 2])
  assert.equal(retries[0]?.message, "auth_unavailable: no auth available")
})

test("model retries an initially silent stream twice and then recovers", async (context) => {
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.flushHeaders()
    if (requests < 3) return
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "recovered" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Server did not expose a port")

  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "test-model",
    streamIdleTimeoutMs: 20,
    retry: { maxRetries: 0 },
  })
  const result = await model.complete({ messages: [{ role: "user", content: "test" }], tools: [] })

  assert.equal(result.content, "recovered")
  assert.equal(requests, 3)
})

test("model does not replay a stream that stalls after receiving data", async (context) => {
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "working" } }] })}\n\n`)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Server did not expose a port")

  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "test-model",
    streamIdleTimeoutMs: 20,
    retry: { maxRetries: 0 },
  })
  const reasoning: string[] = []
  await assert.rejects(
    model.complete({ messages: [{ role: "user", content: "test" }], tools: [] }, { onReasoningDelta: (delta) => reasoning.push(delta) }),
    /No model stream activity/,
  )
  assert.deepEqual(reasoning, ["working"])
  assert.equal(requests, 1, "replaying after partial output could duplicate tool calls")
})

test("model request times out while waiting for response headers", async (context) => {
  const server = createServer(() => undefined)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Server did not expose a port")

  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "test-model",
    timeoutMs: 20,
    retry: { maxRetries: 0 },
  })
  await assert.rejects(
    model.complete({ messages: [{ role: "user", content: "test" }], tools: [] }),
    /did not return response headers within 20ms/,
  )
})
