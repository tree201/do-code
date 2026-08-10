import type { ModelProviderModelConfig, ProviderConfig, ReasoningEffort, ThinkingMode, ThinkingTransport } from "./config-contracts.js"

export function migrateProviders(value: unknown, source: string): Record<string, ProviderConfig> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${source}.providers must be an object`)
  const providers: Record<string, ProviderConfig> = {}
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${source}.providers.${name} must be an object`)
    const provider = item as Record<string, unknown>
    const normalized: ProviderConfig = {}
    if (provider.baseUrl !== undefined) {
      if (typeof provider.baseUrl !== "string" || !/^https?:\/\//.test(provider.baseUrl)) throw new Error(`${source}.providers.${name}.baseUrl must be an HTTP(S) URL`)
      normalized.baseUrl = provider.baseUrl
    }
    if (provider.apiKeyEnv !== undefined) {
      if (typeof provider.apiKeyEnv !== "string" || !/^[A-Z_][A-Z0-9_]*$/i.test(provider.apiKeyEnv)) throw new Error(`${source}.providers.${name}.apiKeyEnv is invalid`)
      normalized.apiKeyEnv = provider.apiKeyEnv
    }
    if (provider.models !== undefined) {
      if (!provider.models || typeof provider.models !== "object" || Array.isArray(provider.models)) throw new Error(`${source}.providers.${name}.models must be an object`)
      normalized.models = {}
      for (const [preset, modelValue] of Object.entries(provider.models as Record<string, unknown>)) {
        if (!modelValue || typeof modelValue !== "object" || Array.isArray(modelValue)) throw new Error(`${source}.providers.${name}.models.${preset} must be an object`)
        const model = modelValue as Record<string, unknown>
        if (model.modelId !== undefined && typeof model.modelId !== "string") throw new Error(`${source}.providers.${name}.models.${preset}.modelId must be a string`)
        const contextWindowInvalid = model.contextWindow !== undefined && contextWindowIsInvalid(model.contextWindow)
        if (contextWindowInvalid) throw new Error(`${source}.providers.${name}.models.${preset}.contextWindow is invalid`)
        normalized.models[preset] = { ...(typeof model.modelId === "string" ? { modelId: model.modelId } : {}), ...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}) }
      }
    }
    providers[name] = normalized
  }
  return providers
}

export function migrateModelProviders(value: unknown, source: string): Record<string, ModelProviderModelConfig[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}.modelProviders must be an object`)
  const providers: Record<string, ModelProviderModelConfig[]> = {}
  for (const [provider, modelsValue] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(modelsValue)) throw new Error(`${source}.modelProviders.${provider} must be an array`)
    providers[provider] = modelsValue.map((value, index) => migrateModelProviderModel(value, `${source}.modelProviders.${provider}.${index}`))
  }
  return providers
}

function migrateModelProviderModel(value: unknown, source: string): ModelProviderModelConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`)
  const model = value as Record<string, unknown>
  if (typeof model.id !== "string" || !model.id.trim()) throw new Error(`${source}.id is required`)
  if (model.baseUrl !== undefined && (typeof model.baseUrl !== "string" || !/^https?:\/\//.test(model.baseUrl))) throw new Error(`${source}.baseUrl must be an HTTP(S) URL`)
  if (model.envKey !== undefined && (typeof model.envKey !== "string" || !/^[A-Z_][A-Z0-9_]*$/i.test(model.envKey))) throw new Error(`${source}.envKey is invalid`)
  const supportedEfforts = model.supportedEfforts === undefined ? undefined : strings(model.supportedEfforts, `${source}.supportedEfforts`) as ReasoningEffort[]
  if (supportedEfforts?.some((item) => !["low", "medium", "high", "xhigh", "max"].includes(item))) throw new Error(`${source}.supportedEfforts is invalid`)
  const supportedThinkingModes = model.supportedThinkingModes === undefined ? undefined : strings(model.supportedThinkingModes, `${source}.supportedThinkingModes`) as ThinkingMode[]
  if (supportedThinkingModes?.some((item) => !["auto", "on", "off"].includes(item))) throw new Error(`${source}.supportedThinkingModes is invalid`)
  if (model.thinkingTransport !== undefined && !["reasoning-effort", "glm-thinking", "deepseek-thinking", "enable-thinking"].includes(String(model.thinkingTransport))) throw new Error(`${source}.thinkingTransport is invalid`)
  const generation = model.generationConfig
  if (generation !== undefined && (!generation || typeof generation !== "object" || Array.isArray(generation))) throw new Error(`${source}.generationConfig must be an object`)
  if (generation) for (const key of ["timeoutMs", "streamIdleTimeoutMs", "maxRetries"] as const) {
    const current = (generation as Record<string, unknown>)[key]
    if (current !== undefined && (!Number.isInteger(current) || Number(current) < 0)) throw new Error(`${source}.generationConfig.${key} must be a non-negative integer`)
  }
  return {
    id: model.id.trim(),
    ...(typeof model.name === "string" ? { name: model.name } : {}),
    ...(typeof model.baseUrl === "string" ? { baseUrl: model.baseUrl } : {}),
    ...(typeof model.envKey === "string" ? { envKey: model.envKey } : {}),
    ...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
    ...(typeof model.maxOutputTokens === "number" ? { maxOutputTokens: model.maxOutputTokens } : {}),
    ...(typeof model.supportsImages === "boolean" ? { supportsImages: model.supportsImages } : {}),
    ...(supportedEfforts ? { supportedEfforts } : {}),
    ...(supportedThinkingModes ? { supportedThinkingModes } : {}),
    ...(typeof model.thinkingTransport === "string" ? { thinkingTransport: model.thinkingTransport as ThinkingTransport } : {}),
    ...(generation ? { generationConfig: generation as NonNullable<ModelProviderModelConfig["generationConfig"]> } : {}),
  }
}

function strings(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be an array of strings`)
  return value as string[]
}

function contextWindowIsInvalid(value: unknown) {
  if (!Number.isInteger(value)) return true
  return Number(value) < Math.pow(2, 10)
}
