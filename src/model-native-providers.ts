import type { RuntimeModelConfig } from "./config.js"
import type { ChatModel, Message, ModelReply, ModelRequestOptions, ToolDefinition } from "./protocol.js"
import { configuredModelTimeout, DEFAULT_THINKING_BUDGET, LOW_THINKING_BUDGET, MEDIUM_THINKING_BUDGET, MODEL_API_TIMEOUT_ENV, MODEL_STREAM_IDLE_TIMEOUT_ENV } from "./model-retry.js"
import { anthropicContent, imageData, inlineImageUrl, requireImageSupport } from "./model-content.js"
import { consumeSse } from "./model-streaming.js"
import { fetchModelResponse } from "./model-request-transport.js"
import { DEFAULT_MODEL_REQUEST_TIMEOUT_MS } from "./model-request-transport.js"
import { DEFAULT_STREAM_IDLE_TIMEOUT_MS } from "./model-streaming.js"
import { anthropicToolSchemas, geminiToolSchemas } from "./model-tool-schemas.js"

export class AnthropicCompatibleModel implements ChatModel {
  readonly usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0 }
  constructor(private readonly config: RuntimeModelConfig) {}

  async complete(input: { messages: Message[]; tools: ToolDefinition[] }, options: ModelRequestOptions = {}): Promise<ModelReply> {
    requireImageSupport(input.messages, this.config.supportsImages, this.config.modelId)
    this.usage.requests++
    const system = input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n")
    const messages: Array<Record<string, unknown>> = []
    for (const message of input.messages.filter((item) => item.role !== "system")) {
      if (message.role === "tool") messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: message.tool_call_id, content: message.content }] })
      else if (message.role === "assistant") messages.push({ role: "assistant", content: [
        ...(message.content ? [{ type: "text", text: message.content }] : []),
        ...(message.tool_calls ?? []).map((call) => ({ type: "tool_use", id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments || "{}") })),
      ] })
      else messages.push({ role: "user", content: await anthropicContent(message.content, options.sessionDirectory) })
    }
    const timeoutMs = configuredModelTimeout(this.config.generationConfig?.timeoutMs, MODEL_API_TIMEOUT_ENV, DEFAULT_MODEL_REQUEST_TIMEOUT_MS)
    const streamIdleTimeoutMs = configuredModelTimeout(this.config.generationConfig?.streamIdleTimeoutMs, MODEL_STREAM_IDLE_TIMEOUT_ENV, DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    const requestUrl = `${this.config.baseUrl.replace(/\/$/, "")}/v1/messages`
    const thinking = anthropicThinking(this.config)
    const toolDefinitions = anthropicToolSchemas(input.tools)
    const body = anthropicRequestBody(this.config, system, messages, options.maxOutputTokens, toolDefinitions, thinking)
    const requestBody = {
      method: "POST",
      headers: { "x-api-key": this.config.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", ...this.config.generationConfig?.headers },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    } as RequestInit
    const response = await fetchModelResponse(requestUrl, requestBody, this.config.generationConfig?.maxRetries === undefined ? {} : { maxRetries: this.config.generationConfig.maxRetries }, timeoutMs, options.onRetry)
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(body.error?.message ?? `Model request failed with HTTP ${response.status}`)
    }
    if (!response.body) throw new Error("Model streaming response did not contain a body")
    let content = ""
    let reasoningContent = ""
    let finishReason: string | null = null
    let inputTokens = 0
    let outputTokens = 0
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
    await consumeSse(response.body, options, (data) => {
      const event = JSON.parse(data) as { type?: string; error?: { message?: string }; index?: number; content_block?: { type?: string; id?: string; name?: string }; delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string }; message?: { usage?: { input_tokens?: number } }; usage?: { output_tokens?: number } }
      if (event.type === "error") throw new Error(event.error?.message ?? "Anthropic model stream failed")
      if (event.type === "message_start") inputTokens = event.message?.usage?.input_tokens ?? inputTokens
      if (event.type === "message_delta") { finishReason = event.delta?.stop_reason ?? finishReason; outputTokens = event.usage?.output_tokens ?? outputTokens }
      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") toolCalls.set(event.index ?? 0, { id: event.content_block.id ?? `call_${event.index ?? 0}`, name: event.content_block.name ?? "", arguments: "" })
      if (event.delta?.type === "text_delta" && event.delta.text) { content += event.delta.text; options.onContentDelta?.(event.delta.text) }
      if (event.delta?.type === "thinking_delta" && event.delta.thinking) { reasoningContent += event.delta.thinking; options.onReasoningDelta?.(event.delta.thinking) }
      if (event.delta?.type === "input_json_delta") {
        const call = toolCalls.get(event.index ?? 0)
        if (call) call.arguments += event.delta.partial_json ?? ""
      }
    }, streamIdleTimeoutMs)
    const resultUsage = { inputTokens, outputTokens, cachedTokens: 0 }
    this.usage.inputTokens += inputTokens
    this.usage.outputTokens += outputTokens
    return { content: content || null, reasoningContent: reasoningContent || null, toolCalls: [...toolCalls.values()].map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments || "{}" } })), finishReason, usage: resultUsage }
  }
}

function anthropicThinking(config: RuntimeModelConfig) {
  if (config.effectiveThinkingMode === "off") return {}
  const effort = config.effectiveReasoningEffort
  let budgetTokens = DEFAULT_THINKING_BUDGET
  if (effort === "low") budgetTokens = LOW_THINKING_BUDGET
  else if (effort === "medium") budgetTokens = MEDIUM_THINKING_BUDGET
  return { thinking: { type: "enabled", budget_tokens: budgetTokens } }
}

function anthropicRequestBody(config: RuntimeModelConfig, system: string, messages: Array<Record<string, unknown>>, maxOutputTokens: number | undefined, tools: Array<Record<string, unknown>>, thinking: Record<string, unknown>) {
  return {
    model: config.modelId,
    system,
    messages,
    stream: true,
    max_tokens: maxOutputTokens ?? config.maxOutputTokens ?? DEFAULT_THINKING_BUDGET,
    tools,
    ...thinking,
  }
}

export class GeminiCompatibleModel implements ChatModel {
  readonly usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0 }
  constructor(private readonly config: RuntimeModelConfig) {}

  async complete(input: { messages: Message[]; tools: ToolDefinition[] }, options: ModelRequestOptions = {}): Promise<ModelReply> {
    requireImageSupport(input.messages, this.config.supportsImages, this.config.modelId)
    this.usage.requests++
    const contents = await Promise.all(input.messages.filter((message) => message.role !== "system").map(async (message) => {
      if (message.role === "tool") return { role: "user", parts: [{ functionResponse: { name: message.tool_call_id, response: { output: message.content } } }] }
      if (message.role === "assistant") return { role: "model", parts: [{ text: message.content ?? "" }, ...(message.tool_calls ?? []).map((call) => ({ functionCall: { name: call.function.name, args: JSON.parse(call.function.arguments || "{}") } }))] }
      const parts = typeof message.content === "string" ? [{ text: message.content }] : await Promise.all((message.content ?? []).map(async (part) => {
        if (part.type === "text") return { text: part.text }
        if (part.type === "image_url") {
          const image = inlineImageUrl(part.image_url.url)
          return { inlineData: { mimeType: image.mimeType, data: image.data } }
        }
        const image = await imageData(part, options.sessionDirectory)
        return { inlineData: { mimeType: image.mimeType, data: image.data } }
      }))
      return { role: "user", parts }
    }))
    const base = this.config.baseUrl.replace(/\/$/, "")
    const url = `${base}/v1beta/models/${encodeURIComponent(this.config.modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.config.apiKey)}`
    const timeoutMs = configuredModelTimeout(this.config.generationConfig?.timeoutMs, MODEL_API_TIMEOUT_ENV, DEFAULT_MODEL_REQUEST_TIMEOUT_MS)
    const streamIdleTimeoutMs = configuredModelTimeout(this.config.generationConfig?.streamIdleTimeoutMs, MODEL_STREAM_IDLE_TIMEOUT_ENV, DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    const response = await fetchModelResponse(url, { method: "POST", headers: { "content-type": "application/json", ...this.config.generationConfig?.headers }, body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n") }] }, tools: [{ functionDeclarations: geminiToolSchemas(input.tools) }], generationConfig: { maxOutputTokens: options.maxOutputTokens ?? this.config.maxOutputTokens, temperature: this.config.generationConfig?.temperature, topP: this.config.generationConfig?.topP, thinkingConfig: this.config.effectiveThinkingMode === "off" ? { includeThoughts: false, thinkingBudget: 0 } : { includeThoughts: true, thinkingLevel: this.config.effectiveReasoningEffort === "low" ? "LOW" : "HIGH" } } }), ...(options.signal ? { signal: options.signal } : {}) }, this.config.generationConfig?.maxRetries === undefined ? {} : { maxRetries: this.config.generationConfig.maxRetries }, timeoutMs, options.onRetry)
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(body.error?.message ?? `Model request failed with HTTP ${response.status}`)
    }
    if (!response.body) throw new Error("Model streaming response did not contain a body")
    let content = ""
    let reasoningContent = ""
    let finishReason: string | null = null
    let inputTokens = 0
    let outputTokens = 0
    const toolCalls = new Map<string, NonNullable<ModelReply["toolCalls"]>[number]>()
    await consumeSse(response.body, options, (data) => {
      const chunk = JSON.parse(data) as { error?: { message?: string }; candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean; functionCall?: { name?: string; args?: unknown } }> }; finishReason?: string }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }
      if (chunk.error) throw new Error(chunk.error.message ?? "Gemini model stream failed")
      inputTokens = chunk.usageMetadata?.promptTokenCount ?? inputTokens
      outputTokens = chunk.usageMetadata?.candidatesTokenCount ?? outputTokens
      const candidate = chunk.candidates?.[0]
      finishReason = candidate?.finishReason ?? finishReason
      for (const part of candidate?.content?.parts ?? []) {
        if (part.functionCall) {
          const name = part.functionCall.name ?? ""
          const args = JSON.stringify(part.functionCall.args ?? {})
          const key = `${name}\0${args}`
          if (!toolCalls.has(key)) toolCalls.set(key, { id: `call_${toolCalls.size}`, type: "function", function: { name, arguments: args } })
        } else if (part.text && part.thought) { reasoningContent += part.text; options.onReasoningDelta?.(part.text) }
        else if (part.text) { content += part.text; options.onContentDelta?.(part.text) }
      }
    }, streamIdleTimeoutMs)
    const resultUsage = { inputTokens, outputTokens, cachedTokens: 0 }
    this.usage.inputTokens += inputTokens
    this.usage.outputTokens += outputTokens
    return { content: content || null, reasoningContent: reasoningContent || null, toolCalls: [...toolCalls.values()], finishReason, usage: resultUsage }
  }
}
