import type { ModelReply } from "./protocol.js"

export type UsagePayload = {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

export type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: ModelReply["toolCalls"] }; finish_reason?: string | null }>
  error?: { message?: string }
  usage?: UsagePayload
}

export type ChatCompletionChunk = {
  choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: Array<{ index?: number; id?: string; type?: "function"; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>
  error?: { message?: string }
  usage?: UsagePayload
}

export function usage(payload?: UsagePayload) {
  return {
    inputTokens: Number(payload?.prompt_tokens ?? 0),
    outputTokens: Number(payload?.completion_tokens ?? 0),
    cachedTokens: Number(payload?.prompt_tokens_details?.cached_tokens ?? 0),
  }
}

export function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message
  return fallback
}

export function parseOpenAIResponse(body: ChatCompletionResponse): ModelReply {
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
