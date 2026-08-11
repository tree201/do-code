import type { ApprovalMode, SandboxNetworkMode } from "./policy-contracts.js"

export type { SandboxNetworkMode } from "./policy-contracts.js"

export type ProviderConfig = {
  baseUrl?: string
  apiKeyEnv?: string
  models?: Record<string, { modelId?: string; contextWindow?: number }>
}

export type ProviderProtocol = "openai-compatible" | "anthropic" | "gemini"
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max"
export type ThinkingMode = "auto" | "on" | "off"
export type ThinkingTransport = "reasoning-effort" | "glm-thinking" | "deepseek-thinking" | "enable-thinking"

export type ModelProviderModelConfig = {
  id: string
  name?: string
  baseUrl?: string
  envKey?: string
  contextWindow?: number
  maxOutputTokens?: number
  supportsImages?: boolean
  supportedEfforts?: ReasoningEffort[]
  supportedThinkingModes?: ThinkingMode[]
  thinkingTransport?: ThinkingTransport
  generationConfig?: {
    temperature?: number
    topP?: number
    maxRetries?: number
    /** Maximum time to receive HTTP response headers. Zero disables it. */
    timeoutMs?: number
    /** Maximum inactivity between raw streaming chunks. Zero disables it. */
    streamIdleTimeoutMs?: number
    headers?: Record<string, string>
    extraBody?: Record<string, unknown>
  }
}

export type HookEvent = "sessionStart" | "beforeModel" | "beforeTool" | "afterTool" | "sessionEnd" | "error"

export type McpServerConfig = {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
}

export type AgentProfileConfig = {
  model?: string
  approvalMode?: ApprovalMode
  instructions?: string
  maxSteps?: number
  tools?: { allow?: string[]; deny?: string[] }
}

export type DoCodeLanguage = "en" | "zh" | "ja" | "ko" | "es" | "fr"

export type StoredConfig = {
  version: 2
  defaultModel?: string
  defaultAgent?: string
  language?: DoCodeLanguage
  agents?: Record<string, AgentProfileConfig>
  providers?: Record<string, ProviderConfig>
  modelProviders?: Record<string, ModelProviderModelConfig[]>
  /** Provider IDs explicitly select one of the stable protocol adapters. */
  providerProtocol?: Record<string, ProviderProtocol>
  env?: Record<string, string>
  defaultReasoningEffort?: ReasoningEffort
  defaultThinkingMode?: ThinkingMode
  hooks?: Partial<Record<HookEvent, string[]>>
  mcpServers?: Record<string, McpServerConfig>
  sandbox?: { type?: "local" | "container" | "seatbelt"; image?: string; network?: SandboxNetworkMode }
  subagents?: { enabled?: boolean; maxDepth?: number }
}

export type RuntimeModelConfig = {
  source: "environment" | "config"
  sourceLabel: string
  preset: string
  provider: string
  modelId: string
  baseUrl: string
  apiKey: string
  contextWindow?: number
  protocol?: ProviderProtocol
  reasoningEffort?: ReasoningEffort
  effectiveReasoningEffort?: ReasoningEffort
  thinkingMode?: ThinkingMode
  effectiveThinkingMode?: ThinkingMode
  thinkingTransport?: ThinkingTransport
  maxOutputTokens?: number
  supportsImages?: boolean
  generationConfig?: ModelProviderModelConfig["generationConfig"]
}

export type ResolvedConfig = StoredConfig & {
  sources: string[]
}
