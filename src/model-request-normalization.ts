import type { ThinkingMode, ThinkingTransport } from "./config.js"

export function openAIThinkingFields(model: string, transport: ThinkingTransport | undefined, mode: ThinkingMode, effort?: string): Record<string, unknown> {
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
