import type { ChatModel, Message, ModelReply, ModelRequestOptions, ToolDefinition, UserContentPart } from "./protocol.js"
import type { RuntimeModelConfig } from "./config.js"
import { openAIThinkingFields } from "./model-request-normalization.js"
import { configuredModelTimeout, isRetryableModelRequestError, MODEL_API_TIMEOUT_ENV, MODEL_STREAM_IDLE_TIMEOUT_ENV } from "./model-retry.js"
import { anthropicContent, imageData, inlineImageUrl, openAIContent, requireImageSupport } from "./model-content.js"
import { consumeSse, streamWithInactivityTimeout, StreamInactivityTimeoutError, DEFAULT_STREAM_IDLE_TIMEOUT_MS } from "./model-streaming.js"
import { AnthropicCompatibleModel as NativeAnthropicModel, GeminiCompatibleModel as NativeGeminiModel } from "./model-native-providers.js"
import { errorMessage, parseOpenAIResponse, type ChatCompletionChunk, type ChatCompletionResponse, usage } from "./model-openai-parsing.js"
import { abortableDelay, fetchModelResponse, DEFAULT_MODEL_REQUEST_TIMEOUT_MS } from "./model-request-transport.js"
import { OpenAIStreamAccumulator } from "./model-openai-stream.js"
import { anthropicToolSchemas, geminiToolSchemas } from "./model-tool-schemas.js"

export { isRetryableModelRequestError } from "./model-retry.js"

export { MODEL_REQUEST_MAX_RETRIES, DEFAULT_MODEL_REQUEST_TIMEOUT_MS, ModelRequestTimeoutError } from "./model-request-transport.js"
export { DEFAULT_STREAM_IDLE_TIMEOUT_MS } from "./model-streaming.js"
export const STREAM_IDLE_RETRIES = 5

type ModelRetryConfig = {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  jitter?: number
}

export { StreamInactivityTimeoutError } from "./model-streaming.js"

export class OpenAICompatibleModel implements ChatModel {
  readonly usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0 }

  constructor(
    private readonly config: {
      apiKey: string
      baseUrl: string
      model: string
      temperature?: number
      stream?: boolean
      retry?: ModelRetryConfig
      reasoningEffort?: string
      thinkingMode?: "auto" | "on" | "off"
      thinkingTransport?: "reasoning-effort" | "glm-thinking" | "deepseek-thinking" | "enable-thinking"
      maxOutputTokens?: number
      topP?: number
      headers?: Record<string, string>
      extraBody?: Record<string, unknown>
      timeoutMs?: number
      streamIdleTimeoutMs?: number
      supportsImages?: boolean
    },
  ) {}

  private recordUsage(value: ModelReply["usage"]) {
    if (!value) return
    this.usage.inputTokens += value.inputTokens
    this.usage.outputTokens += value.outputTokens
    this.usage.cachedTokens += value.cachedTokens
  }


  async complete(input: { messages: Message[]; tools: ToolDefinition[] }, options: ModelRequestOptions = {}): Promise<ModelReply> {
    requireImageSupport(input.messages, this.config.supportsImages, this.config.model)
    const stream = this.config.stream !== false
    this.usage.requests += 1
      const timeoutMs = configuredModelTimeout(this.config.timeoutMs, MODEL_API_TIMEOUT_ENV, DEFAULT_MODEL_REQUEST_TIMEOUT_MS)
      const streamIdleTimeoutMs = configuredModelTimeout(this.config.streamIdleTimeoutMs, MODEL_STREAM_IDLE_TIMEOUT_ENV, DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    const requestMessages = await Promise.all(input.messages.map(async (message) => {
      if (message.role !== "user" || typeof message.content === "string") return message
      return { ...message, content: await openAIContent(message.content, options.sessionDirectory) }
    }))
    const requestBody = JSON.stringify({
      model: this.config.model,
      messages: requestMessages,
      tools: input.tools,
      tool_choice: "auto",
      temperature: this.config.temperature ?? 0,
      ...(this.config.topP !== undefined ? { top_p: this.config.topP } : {}),
      ...(options.maxOutputTokens ?? this.config.maxOutputTokens ? { max_tokens: options.maxOutputTokens ?? this.config.maxOutputTokens } : {}),
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...this.config.extraBody,
      ...openAIThinkingFields(this.config.model, this.config.thinkingTransport, this.config.thinkingMode ?? "auto", this.config.reasoningEffort),
    })

    const completeOnce = async (): Promise<ModelReply> => {
      const response = await fetchModelResponse(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          ...this.config.headers,
        },
        body: requestBody,
        ...(options.signal ? { signal: options.signal } : {}),
      }, this.config.retry, timeoutMs, options.onRetry)

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(errorMessage((body as ChatCompletionResponse).error, `Model request failed with HTTP ${response.status}`))
      }

      const contentType = response.headers.get("content-type") ?? ""
      if (!stream || contentType.includes("application/json")) {
        const result = parseOpenAIResponse(await response.json() as ChatCompletionResponse)
        if (result.reasoningContent) options.onReasoningDelta?.(result.reasoningContent)
        if (result.content) options.onContentDelta?.(result.content)
        return result
      }
      if (!response.body) throw new Error("Model streaming response did not contain a body")

       let buffer = ""
       const decoder = new TextDecoder()
       const accumulator = new OpenAIStreamAccumulator()

      for await (const chunk of streamWithInactivityTimeout(response.body, streamIdleTimeoutMs, options.signal)) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          const trimmed = line.trim()
           if (trimmed.startsWith("data:")) accumulator.consume(trimmed.slice(5).trim(), options.onContentDelta, options.onReasoningDelta)
        }
      }
      buffer += decoder.decode()
      for (const line of buffer.split(/\r?\n/)) {
        const trimmed = line.trim()
         if (trimmed.startsWith("data:")) accumulator.consume(trimmed.slice(5).trim(), options.onContentDelta, options.onReasoningDelta)
       }

       return accumulator.result()
    }

    let result: ModelReply | undefined
    for (let attempt = 0; attempt <= STREAM_IDLE_RETRIES; attempt++) {
      try {
        result = await completeOnce()
        break
      } catch (error) {
        if (!(error instanceof StreamInactivityTimeoutError || isRetryableModelRequestError(error)) || attempt === STREAM_IDLE_RETRIES) throw error
        const delayMs = Math.min(1_000 * 2 ** attempt, 60_000)
        options.onRetry?.(attempt + 1, delayMs, error instanceof Error ? error.message : String(error))
        await abortableDelay(delayMs, options.signal)
      }
    }
    if (!result) throw new Error("Model request completed without a result")
    this.recordUsage(result.usage)
    return result
  }
}

function plainText(content: Message["content"]) {
  if (typeof content === "string") return content
  if (!content) return ""
  return content.filter((part): part is Extract<UserContentPart, { type: "text" }> => part.type === "text").map((part) => part.text).join("\n")
}

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
    const timeoutMs = configuredModelTimeout(this.config.generationConfig?.timeoutMs, "DO_CODE_API_TIMEOUT_MS", DEFAULT_MODEL_REQUEST_TIMEOUT_MS)
    const streamIdleTimeoutMs = configuredModelTimeout(this.config.generationConfig?.streamIdleTimeoutMs, "DO_CODE_STREAM_IDLE_TIMEOUT_MS", DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    const response = await fetchModelResponse(`${this.config.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": this.config.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", ...this.config.generationConfig?.headers },
      body: JSON.stringify({ model: this.config.modelId, system, messages, stream: true, max_tokens: options.maxOutputTokens ?? this.config.maxOutputTokens ?? 8192, tools: anthropicToolSchemas(input.tools), ...(this.config.effectiveThinkingMode === "off" ? {} : { thinking: { type: "enabled", budget_tokens: this.config.effectiveReasoningEffort === "low" ? 1024 : this.config.effectiveReasoningEffort === "medium" ? 4096 : 8192 } }) }),
      ...(options.signal ? { signal: options.signal } : {}),
     }, this.config.generationConfig?.maxRetries === undefined ? {} : { maxRetries: this.config.generationConfig.maxRetries }, timeoutMs, options.onRetry)
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
    this.usage.inputTokens += inputTokens; this.usage.outputTokens += outputTokens
    return { content: content || null, reasoningContent: reasoningContent || null, toolCalls: [...toolCalls.values()].map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments || "{}" } })), finishReason, usage: resultUsage }
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
    const timeoutMs = configuredModelTimeout(this.config.generationConfig?.timeoutMs, "DO_CODE_API_TIMEOUT_MS", DEFAULT_MODEL_REQUEST_TIMEOUT_MS)
    const streamIdleTimeoutMs = configuredModelTimeout(this.config.generationConfig?.streamIdleTimeoutMs, "DO_CODE_STREAM_IDLE_TIMEOUT_MS", DEFAULT_STREAM_IDLE_TIMEOUT_MS)
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
        }
        else if (part.text && part.thought) { reasoningContent += part.text; options.onReasoningDelta?.(part.text) }
        else if (part.text) { content += part.text; options.onContentDelta?.(part.text) }
      }
    }, streamIdleTimeoutMs)
    const resultUsage = { inputTokens, outputTokens, cachedTokens: 0 }
    this.usage.inputTokens += inputTokens; this.usage.outputTokens += outputTokens
    return { content: content || null, reasoningContent: reasoningContent || null, toolCalls: [...toolCalls.values()], finishReason, usage: resultUsage }
  }
}

export function createChatModel(config: RuntimeModelConfig) {
  if (config.protocol === "anthropic") return new NativeAnthropicModel(config)
  if (config.protocol === "gemini") return new NativeGeminiModel(config)
  return new OpenAICompatibleModel({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.modelId, ...((config.effectiveReasoningEffort ?? config.reasoningEffort) ? { reasoningEffort: config.effectiveReasoningEffort ?? config.reasoningEffort } : {}), thinkingMode: config.effectiveThinkingMode ?? config.thinkingMode ?? "auto", ...(config.thinkingTransport ? { thinkingTransport: config.thinkingTransport } : {}), ...(config.maxOutputTokens === undefined ? {} : { maxOutputTokens: config.maxOutputTokens }), ...(config.supportsImages === undefined ? {} : { supportsImages: config.supportsImages }), ...(config.generationConfig?.temperature === undefined ? {} : { temperature: config.generationConfig.temperature }), ...(config.generationConfig?.topP === undefined ? {} : { topP: config.generationConfig.topP }), ...(config.generationConfig?.timeoutMs === undefined ? {} : { timeoutMs: config.generationConfig.timeoutMs }), ...(config.generationConfig?.streamIdleTimeoutMs === undefined ? {} : { streamIdleTimeoutMs: config.generationConfig.streamIdleTimeoutMs }), ...(config.generationConfig?.headers ? { headers: config.generationConfig.headers } : {}), ...(config.generationConfig?.extraBody ? { extraBody: config.generationConfig.extraBody } : {}), retry: config.generationConfig?.maxRetries === undefined ? {} : { maxRetries: config.generationConfig.maxRetries } })
}

export class SwitchableModel implements ChatModel {
  private current: ChatModel
  private currentName: string

  constructor(name: string, model: ChatModel) {
    this.currentName = name
    this.current = model
  }

  get name() { return this.currentName }

  switchTo(name: string, model: ChatModel) {
    this.currentName = name
    this.current = model
  }

  async complete(input: { messages: Message[]; tools: ToolDefinition[] }, options?: ModelRequestOptions) {
    return await this.current.complete(input, options)
  }
}
