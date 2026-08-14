import type { ChatModel, Message } from "../protocol.js"

const SUGGESTION_PROMPT = `Predict the user's most likely next message after this coding-agent response. Return only the suggestion, with no quotes or explanation. Use 2 to 12 words, match the user's language and style, and return nothing when the next step is unclear. Do not ask a question, give praise, use an assistant voice, or suggest an unrelated task.`

export function validFollowupSuggestion(value: string) {
  const suggestion = value.trim()
  if (!suggestion || suggestion.length > 100 || /[\r\n*\u0000-\u001f\u007f-\u009f]/.test(suggestion)) return null
  const words = suggestion.split(/\s+/)
  const hasCjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(suggestion)
  if ((!hasCjk && (words.length < 2 || words.length > 12)) || (hasCjk && (suggestion.length < 2 || suggestion.length > 30))) return null
  if (/^(let me|i('|’)ll|i can|you should|you can|here('|’)s|thanks|looks good|great|perfect|sure[,!]?|当然|我来|你可以)/i.test(suggestion)) return null
  return suggestion
}

export async function generateFollowupSuggestion(model: ChatModel, history: Message[], signal: AbortSignal) {
  const recent = history.filter((message) => message.role !== "system").slice(-12)
  const assistantTurns = recent.filter((message) => message.role === "assistant").length
  if (assistantTurns < 1) return null
  try {
    const reply = await model.complete({
      messages: [...recent, { role: "user", content: SUGGESTION_PROMPT }],
      tools: [],
    }, { signal, maxOutputTokens: 32 })
    return validFollowupSuggestion(reply.content ?? "")
  } catch {
    return null
  }
}
