import type { ReasoningEffort, RuntimeModelConfig, ThinkingMode } from "../config.js"

const REASONING_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"]
const THINKING_MODES: ThinkingMode[] = ["auto", "on", "off"]

export function modelPresetArgument(argument: string) {
  return argument.trim()
}

export function parseReasoningEffort(argument: string): ReasoningEffort | undefined {
  const effort = argument.trim()
  return REASONING_EFFORTS.includes(effort as ReasoningEffort) ? effort as ReasoningEffort : undefined
}

export function parseThinkingMode(argument: string): ThinkingMode | undefined {
  const mode = argument.trim()
  return THINKING_MODES.includes(mode as ThinkingMode) ? mode as ThinkingMode : undefined
}

export function nextReasoningEffort(current: ReasoningEffort | "default") {
  const index = REASONING_EFFORTS.indexOf(current as ReasoningEffort)
  return REASONING_EFFORTS[(index + 1) % REASONING_EFFORTS.length]!
}

export function modelStateFromConfig(config: RuntimeModelConfig) {
  return {
    model: config.preset,
    effort: config.reasoningEffort,
    thinkingMode: config.thinkingMode,
    effectiveEffort: config.effectiveReasoningEffort,
    effectiveThinkingMode: config.effectiveThinkingMode,
  }
}
