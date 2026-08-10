import type { ModelProviderModelConfig, ReasoningEffort, ThinkingMode } from "./config-contracts.js"

export function normalizeReasoningEffort(value?: string): ReasoningEffort | null {
  const normalized = value?.trim().toLowerCase()
  return normalized && ["low", "medium", "high", "xhigh", "max"].includes(normalized) ? normalized as ReasoningEffort : null
}

export function effectiveReasoningEffort(requested: ReasoningEffort, supported?: ReasoningEffort[]) {
  if (!supported?.length || supported.includes(requested)) return requested
  const order: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"]
  const requestedIndex = order.indexOf(requested)
  return [...supported].sort((a, b) => Math.abs(order.indexOf(a) - requestedIndex) - Math.abs(order.indexOf(b) - requestedIndex))[0] ?? requested
}

export function normalizeThinkingMode(value?: string): ThinkingMode | null {
  const normalized = value?.trim().toLowerCase()
  return normalized && ["auto", "on", "off"].includes(normalized) ? normalized as ThinkingMode : null
}

export function effectiveThinkingMode(requested: ThinkingMode, supported?: ThinkingMode[]) {
  if (!supported?.length || supported.includes(requested)) return requested
  if (supported.includes("auto")) return "auto"
  return supported[0] ?? requested
}

export function resolveThinkingTransport(model: ModelProviderModelConfig, baseUrl: string) {
  if (model.thinkingTransport) return model.thinkingTransport
  if (/ark\.cn-[^.]+\.volces\.com/i.test(baseUrl)) return "reasoning-effort" as const
  return undefined
}
