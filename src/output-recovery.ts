export const DEFAULT_MAX_OUTPUT_TOKENS = 32_000
export const ESCALATED_MAX_OUTPUT_TOKENS = 64_000
export const MAX_OUTPUT_RECOVERY_ATTEMPTS = 3
export const MIN_OUTPUT_ROOM_TOKENS = 4_000

export function outputTokenMargin(contextWindow: number) {
  return Math.max(10_000, Math.round(contextWindow * 0.05))
}

export function clampOutputTokens(outputCeiling: number, contextWindow: number, promptTokens: number) {
  const room = contextWindow - promptTokens - outputTokenMargin(contextWindow)
  return Math.min(outputCeiling, Math.max(MIN_OUTPUT_ROOM_TOKENS, room))
}

const RECOVERY_TAIL_CHARACTERS = 1_200
const MAX_OVERLAP_SCAN_CHARACTERS = 4_000

export function outputRecoveryMessage(previousText: string) {
  const lead = "Output token limit hit. Resume directly without apologizing or recapping. Continue from where the response stopped, break the remaining work into smaller pieces, and call a tool as soon as the next action is clear."
  const tail = previousText.slice(-RECOVERY_TAIL_CHARACTERS)
  if (!tail) return lead
  return `${lead}\n\nThe previous response ended with this exact suffix. Do not repeat it; output only what comes after it:\n\n<previous_response_suffix>\n${tail}\n</previous_response_suffix>`
}

export function appendRecoveryContinuation(previous: string, continuation: string) {
  if (!previous || !continuation) return previous + continuation
  const maximum = Math.min(previous.length, continuation.length, MAX_OVERLAP_SCAN_CHARACTERS)
  for (let length = maximum; length >= 8; length--) {
    if (previous.endsWith(continuation.slice(0, length))) return previous + continuation.slice(length)
  }
  return previous + continuation
}
