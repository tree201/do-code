import type { ChatModel, Message, ModelReply, ModelRequestOptions, ToolDefinition } from "./protocol.js"
import type { RuntimeModelConfig } from "./config.js"

export const MODEL_REQUEST_MAX_RETRIES = 5
export const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 120_000
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 120_000
export const STREAM_IDLE_INITIAL_RETRIES = 2

type ModelRetryConfig = {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  jitter?: number
}

export class ModelRequestTimeoutError extends Error {
  readonly code = "ETIMEDOUT" as const
  constructor(readonly timeoutMs: number) {
    super(`Model request did not return response headers within ${timeoutMs}ms`)
    this.name = "ModelRequestTimeoutError"
  }
}

export class StreamInactivityTimeoutError extends Error {
  readonly code = "ETIMEDOUT" as const
  constructor(
    readonly idleMs: number,
    readonly chunksReceived: number,
    readonly streamLifetimeMs: number,
  ) {
    super(`No model stream activity for ${idleMs}ms after ${chunksReceived} chunks (stream lifetime: ${streamLifetimeMs}ms)`)
    this.name = "StreamInactivityTimeoutError"
  }
}

function configuredTimeout(explicit: number | undefined, environmentName: string, fallback: number) {
  if (explicit !== undefined) return explicit
  const raw = process.env[environmentName]?.trim()
  if (raw && /^\d+$/.test(raw)) {
    const value = Number(raw)
    if (Number.isSafeInteger(value)) return value
  }
  return fallback
}

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EPROTO",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "ERR_STREAM_PREMATURE_CLOSE",
])

function networkErrorCode(error: unknown) {
  let current = error
  for (let depth = 0; depth < 6; depth++) {
    if (typeof current !== "object" || current === null) return undefined
    if ("code" in current && typeof current.code === "string") return current.code
    if (!("cause" in current)) return undefined
    current = current.cause
  }
  return undefined
}

export function isRetryableModelRequestError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return false
  const code = networkErrorCode(error)
  if (code && (RETRYABLE_NETWORK_CODES.has(code) || /^ERR_SSL_.*BAD_RECORD_MAC/i.test(code))) return true
  return error instanceof TypeError || (error instanceof Error && error.message.toLowerCase().includes("fetch failed"))
}

function isRetryableModelStatus(status: number) {
  return status === 429 || status === 499 || (status >= 500 && status < 600)
}

function retryAfterMs(response: Response) {
  const value = response.headers.get("retry-after")?.trim()
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

function abortableDelay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"))
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

async function fetchModelResponse(url: string, init: RequestInit, retry: ModelRetryConfig = {}, timeoutMs = DEFAULT_MODEL_REQUEST_TIMEOUT_MS) {
  const maxRetries = retry.maxRetries ?? MODEL_REQUEST_MAX_RETRIES
  const baseDelayMs = retry.baseDelayMs ?? 1_000
  const maxDelayMs = retry.maxDelayMs ?? 16_000
  const jitter = retry.jitter ?? 0.3
  const signal = init.signal ?? undefined
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    let timedOut = false
    const abortFromParent = () => controller.abort(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
    if (signal?.aborted) abortFromParent()
    else signal?.addEventListener("abort", abortFromParent, { once: true })
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true
      controller.abort(new ModelRequestTimeoutError(timeoutMs))
    }, timeoutMs) : undefined
    timer?.unref?.()
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      if (timer) clearTimeout(timer)
      signal?.removeEventListener("abort", abortFromParent)
      if (!isRetryableModelStatus(response.status) || attempt === maxRetries) return response
      const serverDelay = retryAfterMs(response)
      await response.body?.cancel().catch(() => undefined)
      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      const randomizedDelay = Math.max(0, exponentialDelay * (1 + jitter * (Math.random() * 2 - 1)))
      await abortableDelay(Math.max(serverDelay ?? 0, randomizedDelay), signal)
    } catch (error) {
      const effectiveError = timedOut ? new ModelRequestTimeoutError(timeoutMs) : error
      lastError = effectiveError
      if (attempt === maxRetries || !isRetryableModelRequestError(effectiveError)) throw effectiveError
      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      const randomizedDelay = Math.max(0, exponentialDelay * (1 + jitter * (Math.random() * 2 - 1)))
      await abortableDelay(randomizedDelay, signal)
    } finally {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener("abort", abortFromParent)
    }
  }
  throw lastError
}

async function* streamWithInactivityTimeout(
  body: ReadableStream<Uint8Array>,
  idleMs: number,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  const startedAt = Date.now()
  let chunksReceived = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const next = reader.read()
      let timer: ReturnType<typeof setTimeout> | undefined
      let removeAbort: (() => void) | undefined
      const guards: Promise<never>[] = []
      if (idleMs > 0) guards.push(new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new StreamInactivityTimeoutError(idleMs, chunksReceived, Date.now() - startedAt)), idleMs)
        timer.unref?.()
      }))
      if (signal) guards.push(new Promise<never>((_resolve, reject) => {
        const abort = () => reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"))
        signal.addEventListener("abort", abort, { once: true })
        removeAbort = () => signal.removeEventListener("abort", abort)
      }))
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await Promise.race([next, ...guards])
      } catch (error) {
        void reader.cancel(error).catch(() => undefined)
        void next.catch(() => undefined)
        throw error
      } finally {
        if (timer) clearTimeout(timer)
        removeAbort?.()
      }
      if (result.done) return
      chunksReceived++
      yield result.value
    }
  } finally {
    reader.releaseLock()
  }
}

type UsagePayload = {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: ModelReply["toolCalls"]
    }
    finish_reason?: string | null
  }>
  error?: { message?: string }
  usage?: UsagePayload
}

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: "function"
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  error?: { message?: string }
  usage?: UsagePayload
}

function usage(payload?: UsagePayload) {
  return {
    inputTokens: Number(payload?.prompt_tokens ?? 0),
    outputTokens: Number(payload?.completion_tokens ?? 0),
    cachedTokens: Number(payload?.prompt_tokens_details?.cached_tokens ?? 0),
  }
}

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message
  return fallback
}

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
    },
  ) {}

  private recordUsage(value: ModelReply["usage"]) {
    if (!value) return
    this.usage.inputTokens += value.inputTokens
    this.usage.outputTokens += value.outputTokens
    this.usage.cachedTokens += value.cachedTokens
  }

  private parseResponse(body: ChatCompletionResponse): ModelReply {
    if (body.error?.message) throw new Error(body.error.message)
    const message = body.choices?.[0]?.message
    if (!message) throw new Error("Model response did not contain a choice")
    return {
      content: message.content ?? null,
      toolCalls: message.tool_calls ?? [],
      reasoningContent: message.reasoning_content ?? null,
      finishReason: body.choices?.[0]?.finish_reason ?? null,
      usage: usage(body.usage),
    }
  }

  async complete(input: { messages: Message[]; tools: ToolDefinition[] }, options: ModelRequestOptions = {}): Promise<ModelReply> {
    const stream = this.config.stream !== false
    this.usage.requests += 1
    const timeoutMs = configuredTimeout(this.config.timeoutMs, "DO_CODE_API_TIMEOUT_MS", DEFAULT_MODEL_REQUEST_TIMEOUT_MS)
    const streamIdleTimeoutMs = configuredTimeout(this.config.streamIdleTimeoutMs, "DO_CODE_STREAM_IDLE_TIMEOUT_MS", DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    const requestBody = JSON.stringify({
      model: this.config.model,
      messages: input.messages,
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
      }, this.config.retry, timeoutMs)

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(errorMessage((body as ChatCompletionResponse).error, `Model request failed with HTTP ${response.status}`))
      }

      const contentType = response.headers.get("content-type") ?? ""
      if (!stream || contentType.includes("application/json")) {
        const result = this.parseResponse(await response.json() as ChatCompletionResponse)
        if (result.reasoningContent) options.onReasoningDelta?.(result.reasoningContent)
        if (result.content) options.onContentDelta?.(result.content)
        return result
      }
      if (!response.body) throw new Error("Model streaming response did not contain a body")

      let content = ""
      let reasoningContent = ""
      let finishReason: string | null = null
      let finalUsage: ModelReply["usage"]
      let buffer = ""
      const decoder = new TextDecoder()
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()

      const consume = (data: string) => {
        if (!data || data === "[DONE]") return
        const chunk = JSON.parse(data) as ChatCompletionChunk
        if (chunk.error?.message) throw new Error(chunk.error.message)
        if (chunk.usage) finalUsage = usage(chunk.usage)
        const delta = chunk.choices?.[0]?.delta
        const choice = chunk.choices?.[0]
        if (choice?.finish_reason) finishReason = choice.finish_reason
        if (delta?.content) {
          content += delta.content
          options.onContentDelta?.(delta.content)
        }
        if (delta?.reasoning_content) {
          reasoningContent += delta.reasoning_content
          options.onReasoningDelta?.(delta.reasoning_content)
        }
        for (const call of delta?.tool_calls ?? []) {
          const index = call.index ?? 0
          const current = toolCalls.get(index) ?? { id: "", name: "", arguments: "" }
          if (call.id) current.id += call.id
          if (call.function?.name) current.name += call.function.name
          if (call.function?.arguments) current.arguments += call.function.arguments
          toolCalls.set(index, current)
        }
      }

      for await (const chunk of streamWithInactivityTimeout(response.body, streamIdleTimeoutMs, options.signal)) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith("data:")) consume(trimmed.slice(5).trim())
        }
      }
      buffer += decoder.decode()
      for (const line of buffer.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed.startsWith("data:")) consume(trimmed.slice(5).trim())
      }

      return {
        content: content || null,
        reasoningContent: reasoningContent || null,
        finishReason,
        toolCalls: [...toolCalls.entries()]
          .sort(([left], [right]) => left - right)
          .map(([index, call]) => ({
            id: call.id || `call_${index}`,
            type: "function" as const,
            function: { name: call.name, arguments: call.arguments },
          })),
        ...(finalUsage ? { usage: finalUsage } : {}),
      }
    }

    let result: ModelReply | undefined
    for (let attempt = 0; attempt <= STREAM_IDLE_INITIAL_RETRIES; attempt++) {
      try {
        result = await completeOnce()
        break
      } catch (error) {
        const retryableInitialStall = error instanceof StreamInactivityTimeoutError && error.chunksReceived === 0
        if (!retryableInitialStall || attempt === STREAM_IDLE_INITIAL_RETRIES) throw error
        await abortableDelay(Math.min(1_000 * 2 ** attempt, 4_000), options.signal)
      }
    }
    if (!result) throw new Error("Model request completed without a result")
    this.recordUsage(result.usage)
    return result
  }
}

function openAIThinkingFields(model: string, transport: "reasoning-effort" | "glm-thinking" | "deepseek-thinking" | "enable-thinking" | undefined, mode: "auto" | "on" | "off", effort?: string): Record<string, unknown> {
  const selected = transport ?? (/^glm-/i.test(model) ? "glm-thinking" : /^deepseek-/i.test(model) ? "deepseek-thinking" : "reasoning-effort")
  if (mode === "off") {
    if (selected === "glm-thinking") return { thinking: { enabled: false } }
    if (selected === "deepseek-thinking") return { thinking: { type: "disabled" } }
    if (selected === "enable-thinking") return { enable_thinking: false }
    return { reasoning_effort: "none" }
  }
  const enabled = effort ? { reasoning_effort: effort } : {}
  if (mode === "auto") return enabled
  if (selected === "glm-thinking") return { ...enabled, thinking: { enabled: true } }
  if (selected === "deepseek-thinking") return { ...enabled, thinking: { type: "enabled" } }
  if (selected === "enable-thinking") return { ...enabled, enable_thinking: true }
  return enabled
}

function plainText(content: Message["content"]) {
  if (typeof content === "string") return content
  if (!content) return ""
  return content.map((part) => part.type === "text" ? part.text : `[image: ${part.image_url.url}]`).join("\n")
}

export class AnthropicCompatibleModel implements ChatModel {
  readonly usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0 }
  constructor(private readonly config: RuntimeModelConfig) {}

  async complete(input: { messages: Message[]; tools: ToolDefinition[] }, options: ModelRequestOptions = {}): Promise<ModelReply> {
    this.usage.requests++
    const system = input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n")
    const messages: Array<Record<string, unknown>> = []
    for (const message of input.messages.filter((item) => item.role !== "system")) {
      if (message.role === "tool") messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: message.tool_call_id, content: message.content }] })
      else if (message.role === "assistant") messages.push({ role: "assistant", content: [
        ...(message.content ? [{ type: "text", text: message.content }] : []),
        ...(message.tool_calls ?? []).map((call) => ({ type: "tool_use", id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments || "{}") })),
      ] })
      else messages.push({ role: "user", content: plainText(message.content) })
    }
    const response = await fetchModelResponse(`${this.config.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": this.config.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", ...this.config.generationConfig?.headers },
      body: JSON.stringify({ model: this.config.modelId, system, messages, max_tokens: options.maxOutputTokens ?? this.config.maxOutputTokens ?? 8192, tools: input.tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })), ...(this.config.effectiveThinkingMode === "off" ? {} : { thinking: { type: "enabled", budget_tokens: this.config.effectiveReasoningEffort === "low" ? 1024 : this.config.effectiveReasoningEffort === "medium" ? 4096 : 8192 } }) }),
      ...(options.signal ? { signal: options.signal } : {}),
    }, this.config.generationConfig?.maxRetries === undefined ? {} : { maxRetries: this.config.generationConfig.maxRetries })
    const body = await response.json() as { error?: { message?: string }; content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } }
    if (!response.ok) throw new Error(body.error?.message ?? `Model request failed with HTTP ${response.status}`)
    const content = (body.content ?? []).filter((item) => item.type === "text").map((item) => item.text ?? "").join("")
    if (content) options.onContentDelta?.(content)
    const resultUsage={ inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0, cachedTokens: 0 }
    this.usage.inputTokens+=resultUsage.inputTokens;this.usage.outputTokens+=resultUsage.outputTokens
    return { content: content || null, reasoningContent: (body.content ?? []).filter((item) => item.type === "thinking").map((item) => item.thinking ?? "").join("") || null, toolCalls: (body.content ?? []).filter((item) => item.type === "tool_use").map((item, index) => ({ id: item.id ?? `call_${index}`, type: "function", function: { name: item.name ?? "", arguments: JSON.stringify(item.input ?? {}) } })), finishReason: body.stop_reason ?? null, usage: resultUsage }
  }
}

export class GeminiCompatibleModel implements ChatModel {
  readonly usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0 }
  constructor(private readonly config: RuntimeModelConfig) {}

  async complete(input: { messages: Message[]; tools: ToolDefinition[] }, options: ModelRequestOptions = {}): Promise<ModelReply> {
    this.usage.requests++
    const contents = input.messages.filter((message) => message.role !== "system").map((message) => {
      if (message.role === "tool") return { role: "user", parts: [{ functionResponse: { name: message.tool_call_id, response: { output: message.content } } }] }
      if (message.role === "assistant") return { role: "model", parts: [{ text: message.content ?? "" }, ...(message.tool_calls ?? []).map((call) => ({ functionCall: { name: call.function.name, args: JSON.parse(call.function.arguments || "{}") } }))] }
      return { role: "user", parts: [{ text: plainText(message.content) }] }
    })
    const base = this.config.baseUrl.replace(/\/$/, "")
    const url = `${base}/v1beta/models/${encodeURIComponent(this.config.modelId)}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`
    const response = await fetchModelResponse(url, { method: "POST", headers: { "content-type": "application/json", ...this.config.generationConfig?.headers }, body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n") }] }, tools: [{ functionDeclarations: input.tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters })) }], generationConfig: { maxOutputTokens: options.maxOutputTokens ?? this.config.maxOutputTokens, temperature: this.config.generationConfig?.temperature, topP: this.config.generationConfig?.topP, thinkingConfig: this.config.effectiveThinkingMode === "off" ? { includeThoughts: false, thinkingBudget: 0 } : { includeThoughts: true, thinkingLevel: this.config.effectiveReasoningEffort === "low" ? "LOW" : "HIGH" } } }), ...(options.signal ? { signal: options.signal } : {}) }, this.config.generationConfig?.maxRetries === undefined ? {} : { maxRetries: this.config.generationConfig.maxRetries })
    const body = await response.json() as { error?: { message?: string }; candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: unknown } }> }; finishReason?: string }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }
    if (!response.ok) throw new Error(body.error?.message ?? `Model request failed with HTTP ${response.status}`)
    const parts = body.candidates?.[0]?.content?.parts ?? []
    const content = parts.map((part) => part.text ?? "").join("")
    if (content) options.onContentDelta?.(content)
    const resultUsage={ inputTokens: body.usageMetadata?.promptTokenCount ?? 0, outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0, cachedTokens: 0 }
    this.usage.inputTokens+=resultUsage.inputTokens;this.usage.outputTokens+=resultUsage.outputTokens
    return { content: content || null, toolCalls: parts.filter((part) => part.functionCall).map((part, index) => ({ id: `call_${index}`, type: "function", function: { name: part.functionCall?.name ?? "", arguments: JSON.stringify(part.functionCall?.args ?? {}) } })), finishReason: body.candidates?.[0]?.finishReason ?? null, usage: resultUsage }
  }
}

export function createChatModel(config: RuntimeModelConfig) {
  if (config.protocol === "anthropic") return new AnthropicCompatibleModel(config)
  if (config.protocol === "gemini") return new GeminiCompatibleModel(config)
  return new OpenAICompatibleModel({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.modelId, ...((config.effectiveReasoningEffort ?? config.reasoningEffort) ? { reasoningEffort: config.effectiveReasoningEffort ?? config.reasoningEffort } : {}), thinkingMode: config.effectiveThinkingMode ?? config.thinkingMode ?? "auto", ...(config.thinkingTransport ? { thinkingTransport: config.thinkingTransport } : {}), ...(config.maxOutputTokens === undefined ? {} : { maxOutputTokens: config.maxOutputTokens }), ...(config.generationConfig?.temperature === undefined ? {} : { temperature: config.generationConfig.temperature }), ...(config.generationConfig?.topP === undefined ? {} : { topP: config.generationConfig.topP }), ...(config.generationConfig?.timeoutMs === undefined ? {} : { timeoutMs: config.generationConfig.timeoutMs }), ...(config.generationConfig?.streamIdleTimeoutMs === undefined ? {} : { streamIdleTimeoutMs: config.generationConfig.streamIdleTimeoutMs }), ...(config.generationConfig?.headers ? { headers: config.generationConfig.headers } : {}), ...(config.generationConfig?.extraBody ? { extraBody: config.generationConfig.extraBody } : {}), retry: config.generationConfig?.maxRetries === undefined ? {} : { maxRetries: config.generationConfig.maxRetries } })
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
