import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { openAIThinkingFields } from "../src/model-request-normalization.js"
import { AnthropicCompatibleModel, GeminiCompatibleModel, OpenAICompatibleModel } from "../src/model.js"

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

test("model rejects image input before HTTP when capability is disabled", async () => {
  const model = new OpenAICompatibleModel({ apiKey: "test", baseUrl: "https://127.0.0.1.invalid/v1", model: "text-only", supportsImages: false })
  await assert.rejects(
    model.complete({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }] }], tools: [] }),
    /Model does not support image input: text-only/,
  )
  assert.equal(model.usage.requests, 0)
})

test("Anthropic streams reasoning, content, tools, usage, and native image bodies", async (context) => {
  let requestUrl = ""
  let requestBody = ""
  const server = createServer((request, response) => {
    requestUrl = request.url ?? ""
    request.on("data", (chunk: Buffer) => { requestBody += chunk.toString() })
    request.on("end", () => {
      response.writeHead(200, { "content-type": "text/event-stream" })
      const events = [
        { type: "message_start", message: { usage: { input_tokens: 11 } } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "先想" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "正在" } },
        { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tool_1", name: "read_file" } },
        { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"path\":" } },
        { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "\"a.ts\"}" } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } },
      ]
      for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`)
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Server did not expose a port")
  const sessionDirectory = await mkdtemp(path.join(os.tmpdir(), "do-code-anthropic-image-"))
  await mkdir(path.join(sessionDirectory, "attachments"))
  await writeFile(path.join(sessionDirectory, "attachments", "image.png"), Buffer.from("png-data"))
  const content: string[] = []
  const reasoning: string[] = []
  const model = new AnthropicCompatibleModel({
    source: "config", sourceLabel: "test", preset: "anthropic/test", provider: "anthropic", protocol: "anthropic",
    modelId: "test-model", baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "test", supportsImages: true,
  })
  const result = await model.complete({ messages: [{ role: "user", content: [{ type: "text", text: "inspect" }, { type: "image", path: "attachments/image.png", mimeType: "image/png", name: "image.png" }] }], tools: [] }, {
    sessionDirectory, onContentDelta: (delta) => content.push(delta), onReasoningDelta: (delta) => reasoning.push(delta),
  })
  assert.equal(requestUrl, "/v1/messages")
  const payload = JSON.parse(requestBody) as { stream?: boolean; messages?: Array<{ content?: unknown }> }
  assert.equal(payload.stream, true)
  assert.deepEqual(payload.messages?.[0]?.content, [{ type: "text", text: "inspect" }, { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("png-data").toString("base64") } }])
  assert.deepEqual(reasoning, ["先想"])
  assert.deepEqual(content, ["正在"])
  assert.equal(result.reasoningContent, "先想")
  assert.equal(result.content, "正在")
  assert.deepEqual(result.toolCalls, [{ id: "tool_1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a.ts\"}" } }])
  assert.equal(result.finishReason, "tool_use")
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7, cachedTokens: 0 })
})

test("Gemini streams thoughts, content, tools, usage, and native image bodies", async (context) => {
  let requestUrl = ""
  let requestBody = ""
  const server = createServer((request, response) => {
    requestUrl = request.url ?? ""
    request.on("data", (chunk: Buffer) => { requestBody += chunk.toString() })
    request.on("end", () => {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "先想", thought: true }, { text: "答案" }] } }], usageMetadata: { promptTokenCount: 13 } })}\n\n`)
      const toolChunk = { candidates: [{ content: { parts: [{ functionCall: { name: "read_file", args: { path: "a.ts" } } }] }, finishReason: "STOP" }], usageMetadata: { candidatesTokenCount: 5 } }
      response.write(`data: ${JSON.stringify(toolChunk)}\n\n`)
      response.end(`data: ${JSON.stringify(toolChunk)}\n\n`)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Server did not expose a port")
  const sessionDirectory = await mkdtemp(path.join(os.tmpdir(), "do-code-gemini-image-"))
  await mkdir(path.join(sessionDirectory, "attachments"))
  await writeFile(path.join(sessionDirectory, "attachments", "image.webp"), Buffer.from("webp-data"))
  const content: string[] = []
  const reasoning: string[] = []
  const model = new GeminiCompatibleModel({
    source: "config", sourceLabel: "test", preset: "gemini/test", provider: "gemini", protocol: "gemini",
    modelId: "gemini-test", baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "test", supportsImages: true,
  })
  const result = await model.complete({ messages: [{ role: "user", content: [{ type: "text", text: "inspect" }, { type: "image", path: "attachments/image.webp", mimeType: "image/webp", name: "image.webp" }] }], tools: [] }, {
    sessionDirectory, onContentDelta: (delta) => content.push(delta), onReasoningDelta: (delta) => reasoning.push(delta),
  })
  assert.match(requestUrl, /^\/v1beta\/models\/gemini-test:streamGenerateContent\?alt=sse&key=test$/)
  const payload = JSON.parse(requestBody) as { contents?: Array<{ parts?: unknown }> }
  assert.deepEqual(payload.contents?.[0]?.parts, [{ text: "inspect" }, { inlineData: { mimeType: "image/webp", data: Buffer.from("webp-data").toString("base64") } }])
  assert.deepEqual(reasoning, ["先想"])
  assert.deepEqual(content, ["答案"])
  assert.equal(result.reasoningContent, "先想")
  assert.equal(result.content, "答案")
  assert.deepEqual(result.toolCalls, [{ id: "call_0", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a.ts\"}" } }])
  assert.equal(result.finishReason, "STOP")
  assert.deepEqual(result.usage, { inputTokens: 13, outputTokens: 5, cachedTokens: 0 })
})

test("Anthropic and Gemini parse multiline SSE data and surface stream errors", async (context) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" })
    if (request.url?.startsWith("/v1/messages")) {
      response.write('data: {"type":"content_block_delta",\n')
      response.write('data: "delta":{"type":"text_delta","text":"multiline"}}\n\n')
      response.end('data: {"type":"error","error":{"message":"anthropic stream error"}}\n\n')
      return
    }
    response.end('data: {"error":{"message":"gemini stream error"}}\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => server.close())
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Server did not expose a port")
  const baseUrl = `http://127.0.0.1:${address.port}`
  const content: string[] = []
  const anthropic = new AnthropicCompatibleModel({ source: "config", sourceLabel: "test", preset: "a", provider: "a", protocol: "anthropic", modelId: "a", baseUrl, apiKey: "test" })
  await assert.rejects(anthropic.complete({ messages: [{ role: "user", content: "test" }], tools: [] }, { onContentDelta: (delta) => content.push(delta) }), /anthropic stream error/)
  assert.deepEqual(content, ["multiline"])
  const gemini = new GeminiCompatibleModel({ source: "config", sourceLabel: "test", preset: "g", provider: "g", protocol: "gemini", modelId: "g", baseUrl, apiKey: "test" })
  await assert.rejects(gemini.complete({ messages: [{ role: "user", content: "test" }], tools: [] }), /gemini stream error/)
})

test("Anthropic and Gemini reject unsupported image URLs before HTTP", async () => {
  const messages = [{ role: "user" as const, content: [{ type: "image_url" as const, image_url: { url: "https://example.com/image.png" } }] }]
  const anthropic = new AnthropicCompatibleModel({ source: "config", sourceLabel: "test", preset: "a", provider: "a", protocol: "anthropic", modelId: "a", baseUrl: "https://127.0.0.1.invalid", apiKey: "test", supportsImages: true })
  const gemini = new GeminiCompatibleModel({ source: "config", sourceLabel: "test", preset: "g", provider: "g", protocol: "gemini", modelId: "g", baseUrl: "https://127.0.0.1.invalid", apiKey: "test", supportsImages: true })
  await assert.rejects(anthropic.complete({ messages, tools: [] }), /requires a PNG, JPEG, GIF, or WebP base64 data URL/)
  await assert.rejects(gemini.complete({ messages, tools: [] }), /requires a PNG, JPEG, GIF, or WebP base64 data URL/)
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

test("OpenAI thinking fields normalize provider transports without HTTP", () => {
  assert.deepEqual(openAIThinkingFields("glm-5", undefined, "off", "high"), { thinking: { enabled: false } })
  assert.deepEqual(openAIThinkingFields("deepseek-v4", undefined, "on", "high"), { reasoning_effort: "high", thinking: { type: "enabled" } })
  assert.deepEqual(openAIThinkingFields("qwen", "enable-thinking", "off"), { enable_thinking: false })
  assert.deepEqual(openAIThinkingFields("gpt-5", undefined, "auto", "medium"), { reasoning_effort: "medium" })
})
