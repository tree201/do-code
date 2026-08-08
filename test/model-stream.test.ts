import assert from "node:assert/strict"
import { createServer } from "node:http"
import test from "node:test"
import { OpenAICompatibleModel } from "../src/model.js"

test("OpenAI-compatible model streams content and assembles tool calls", async (context) => {
  let requestBody = ""
  const server = createServer((request, response) => {
    request.on("data", (chunk: Buffer) => { requestBody += chunk.toString() })
    request.on("end", () => {
      response.writeHead(200, { "content-type": "text/event-stream" })
      const events = [
        { choices: [{ delta: { reasoning_content: "先分析" } }] },
        { choices: [{ delta: { content: "正在" } }] },
        { choices: [{ delta: { content: "处理" } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "write_", arguments: "{\"path\":\"" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "file", arguments: "a.txt\"}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 12, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 3 } } },
      ]
      for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`)
      response.end("data: [DONE]\n\n")
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Server did not expose a port")

  const deltas: string[] = []
  const reasoningDeltas: string[] = []
  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "test-model",
    reasoningEffort:"high",
  })
  const result = await model.complete(
    { messages: [{ role: "user", content: [{ type: "text", text: "test" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }] }], tools: [] },
    { onContentDelta: (delta) => deltas.push(delta), onReasoningDelta: (delta) => reasoningDeltas.push(delta), maxOutputTokens: 32_000 },
  )

  assert.deepEqual(deltas, ["正在", "处理"])
  assert.deepEqual(reasoningDeltas, ["先分析"])
  assert.equal(result.content, "正在处理")
  assert.equal(result.reasoningContent, "先分析")
  assert.equal(result.finishReason, "tool_calls")
  assert.deepEqual(result.toolCalls, [{
    id: "call_1",
    type: "function",
    function: { name: "write_file", arguments: "{\"path\":\"a.txt\"}" },
  }])
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 5, cachedTokens: 3 })
  assert.equal(model.usage.requests, 1)
  assert.equal(model.usage.inputTokens, 12)
  const payload = JSON.parse(requestBody) as { stream?: boolean; max_tokens?: number; reasoning_effort?:string;messages?: Array<{ content?: unknown }> }
  assert.equal(payload.stream, true)
  assert.equal(payload.max_tokens, 32_000)
  assert.equal(payload.reasoning_effort,"high")
  assert.deepEqual(payload.messages?.[0]?.content, [{ type: "text", text: "test" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }])
})

test("thinking mode maps explicit on and off controls by model family", async (context) => {
  const payloads: Array<Record<string, unknown>> = []
  const server = createServer((request, response) => {
    let body=""
    request.on("data",(chunk:Buffer)=>{body+=chunk.toString()})
    request.on("end",()=>{payloads.push(JSON.parse(body));response.writeHead(200,{"content-type":"application/json"});response.end(JSON.stringify({choices:[{message:{content:"ok"},finish_reason:"stop"}]}))})
  })
  await new Promise<void>((resolve)=>server.listen(0,"127.0.0.1",resolve))
  context.after(()=>server.close())
  const address=server.address();if(!address||typeof address==="string")throw new Error("Server did not expose a port")
  const baseUrl=`http://127.0.0.1:${address.port}/v1`
  for(const config of [
    {model:"glm-5.2",thinkingTransport:"glm-thinking" as const,thinkingMode:"off" as const,reasoningEffort:"high"},
    {model:"deepseek-v4-pro",thinkingTransport:"deepseek-thinking" as const,thinkingMode:"off" as const,reasoningEffort:"high"},
    {model:"glm-5.2",thinkingTransport:"glm-thinking" as const,thinkingMode:"on" as const,reasoningEffort:"high"},
  ])await new OpenAICompatibleModel({apiKey:"test",baseUrl,...config}).complete({messages:[{role:"user",content:"test"}],tools:[]})
  assert.deepEqual(payloads[0]?.thinking,{enabled:false});assert.equal(payloads[0]?.reasoning_effort,undefined)
  assert.deepEqual(payloads[1]?.thinking,{type:"disabled"});assert.equal(payloads[1]?.reasoning_effort,undefined)
  assert.deepEqual(payloads[2]?.thinking,{enabled:true});assert.equal(payloads[2]?.reasoning_effort,"high")
})

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
