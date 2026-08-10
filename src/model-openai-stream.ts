import type { ModelReply } from "./protocol.js"
import { usage, type ChatCompletionChunk } from "./model-openai-parsing.js"

export class OpenAIStreamAccumulator {
  content = ""
  reasoningContent = ""
  finishReason: string | null = null
  usage: ModelReply["usage"] | undefined
  private readonly toolCalls = new Map<number, { id: string; name: string; arguments: string }>()

  consume(data: string, onContentDelta?: (delta: string) => void, onReasoningDelta?: (delta: string) => void) {
    if (!data || data === "[DONE]") return
    const chunk = JSON.parse(data) as ChatCompletionChunk
    if (chunk.error?.message) throw new Error(chunk.error.message)
    if (chunk.usage) this.usage = usage(chunk.usage)
    const delta = chunk.choices?.[0]?.delta
    const choice = chunk.choices?.[0]
    if (choice?.finish_reason) this.finishReason = choice.finish_reason
    if (delta?.content) {
      this.content += delta.content
      onContentDelta?.(delta.content)
    }
    if (delta?.reasoning_content) {
      this.reasoningContent += delta.reasoning_content
      onReasoningDelta?.(delta.reasoning_content)
    }
    for (const call of delta?.tool_calls ?? []) {
      const index = call.index ?? 0
      const current = this.toolCalls.get(index) ?? { id: "", name: "", arguments: "" }
      if (call.id) current.id += call.id
      if (call.function?.name) current.name += call.function.name
      if (call.function?.arguments) current.arguments += call.function.arguments
      this.toolCalls.set(index, current)
    }
  }

  result(): ModelReply {
    return {
      content: this.content || null,
      reasoningContent: this.reasoningContent || null,
      finishReason: this.finishReason,
      toolCalls: [...this.toolCalls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([index, call]) => ({ id: call.id || `call_${index}`, type: "function" as const, function: { name: call.name, arguments: call.arguments } })),
      ...(this.usage ? { usage: this.usage } : {}),
    }
  }
}
