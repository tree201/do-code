import {
  appendRecoveryContinuation,
  clampOutputTokens,
  DEFAULT_MAX_OUTPUT_TOKENS,
  ESCALATED_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_RECOVERY_ATTEMPTS,
  outputRecoveryMessage,
} from "./output-recovery.js"
import { IDENTICAL_TOOL_LOOP_THRESHOLD } from "./turn-limits.js"

export { appendRecoveryContinuation, clampOutputTokens, outputRecoveryMessage, DEFAULT_MAX_OUTPUT_TOKENS, ESCALATED_MAX_OUTPUT_TOKENS, MAX_OUTPUT_RECOVERY_ATTEMPTS }

export type ToolLoopState = { signature: string | null; count: number }

export function nextToolLoopState(state: ToolLoopState, name: string, args: string) {
  const signature = `${name}:${args}`
  const count = signature === state.signature ? state.count + 1 : 1
  return { state: { signature, count }, repeated: count >= IDENTICAL_TOOL_LOOP_THRESHOLD }
}
