import type { ReasoningEffort, ResolvedConfig, RuntimeModelConfig, ThinkingMode } from "./config-contracts.js"
import { listModelPresets } from "./config-catalog.js"
import { effectiveReasoningEffort, effectiveThinkingMode, normalizeReasoningEffort, normalizeThinkingMode, resolveThinkingTransport } from "./config-model-preferences.js"
import { defaultModelSupportsImages } from "./config-provider-resolution.js"
import { loadRecentModels, loadStoredConfig } from "./config-storage.js"

const MODEL_API_KEY = "MODEL_API_KEY"
const MODEL_BASE_URL = "MODEL_BASE_URL"
const MODEL_ID = "MODEL_ID"
const DO_CODE_MODEL = "DO_CODE_MODEL"
const DO_CODE_REASONING_EFFORT = "DO_CODE_REASONING_EFFORT"
const DO_CODE_THINKING_MODE = "DO_CODE_THINKING_MODE"

export async function resolveRuntimeModelConfig(workspace = process.cwd(), requestedModel?: string, requestedProvider?: string, requestedEffort?: string, requestedThinkingMode?: string, resolvedConfig?: ResolvedConfig): Promise<RuntimeModelConfig> {
  const environment = {
    apiKey: process.env[MODEL_API_KEY]?.trim(),
    baseUrl: process.env[MODEL_BASE_URL]?.trim(),
    modelId: process.env[MODEL_ID]?.trim(),
  }
  const config = resolvedConfig ?? await loadStoredConfig(workspace)
  const requested = requestedModel ?? process.env[DO_CODE_MODEL]?.trim() ?? config.defaultModel
  const effort = normalizeReasoningEffort(requestedEffort ?? process.env[DO_CODE_REASONING_EFFORT]) ?? config.defaultReasoningEffort ?? "medium"
  const thinkingMode = normalizeThinkingMode(requestedThinkingMode ?? process.env[DO_CODE_THINKING_MODE]) ?? config.defaultThinkingMode ?? "auto"
  if (environment.apiKey && environment.baseUrl && environment.modelId && !requestedProvider && !requestedModel) {
    return { source: "environment", sourceLabel: "environment variables", preset: environment.modelId, provider: "environment", apiKey: environment.apiKey, baseUrl: environment.baseUrl, modelId: environment.modelId, protocol: "openai-compatible", reasoningEffort: effort, effectiveReasoningEffort: effort, thinkingMode, effectiveThinkingMode: thinkingMode }
  }
  if (requested) {
    const [providerName, ...modelParts] = requested.includes("/") ? requested.split("/") : [requestedProvider ?? "", requested]
    const modelName = modelParts.join("/")
    const modern = await resolveModernModel(config, requested, providerName!, modelName, effort, thinkingMode)
    if (modern) return modern
    const legacy = await resolveLegacyModel(config, requested, providerName!, modelName, effort, thinkingMode)
    if (legacy) return legacy
    throw new Error(`Unknown model preset: ${requested}. Available: ${listModelPresets(config).join(", ") || "none"}`)
  }
  for (const recent of await loadRecentModels()) {
    const preset = `${recent.providerID}/${recent.modelID}`
    const resolved = await resolveConfiguredModel(config, preset, effort, thinkingMode).catch(() => null)
    if (resolved) return { ...resolved, sourceLabel: "recent model" }
  }
  for (const preset of listModelPresets(config)) {
    const resolved = await resolveConfiguredModel(config, preset, effort, thinkingMode).catch(() => null)
    if (resolved) return { ...resolved, sourceLabel: "provider default" }
  }
  throw new Error("No model is configured. Run do-code auth, or set MODEL_API_KEY, MODEL_BASE_URL, and MODEL_ID")
}

async function resolveConfiguredModel(config: ResolvedConfig, requested: string, effort: ReasoningEffort, thinkingMode: ThinkingMode) {
  const [providerName, ...modelParts] = requested.includes("/") ? requested.split("/") : ["", requested]
  const modelName = modelParts.join("/")
  return await resolveModernModel(config, requested, providerName!, modelName, effort, thinkingMode)
    ?? await resolveLegacyModel(config, requested, providerName!, modelName, effort, thinkingMode)
}

async function resolveModernModel(config: ResolvedConfig, requested: string, providerName: string, modelName: string, effort: ReasoningEffort, thinkingMode: ThinkingMode) {
  const model = config.modelProviders?.[providerName]?.find((item) => item.id === modelName)
  if (!model) return null
  let baseUrl = model.baseUrl?.trim()
  let apiKey: string | undefined
  apiKey = model.envKey ? process.env[model.envKey]?.trim() || config.env?.[model.envKey]?.trim() : undefined
  if (!baseUrl || !apiKey) throw new Error(`${requested} is missing baseUrl or credential environment variable ${model.envKey ?? "envKey"}`)
  const thinkingTransport = resolveThinkingTransport(model, baseUrl)
  const supportsImages = model.supportsImages ?? defaultModelSupportsImages(model.id)
  return {
    source: "config" as const,
    sourceLabel: config.sources.at(-1) ?? "configuration",
    preset: requested,
    provider: providerName,
    modelId: model.id,
    baseUrl,
    apiKey,
    protocol: config.providerProtocol?.[providerName] ?? "openai-compatible",
    reasoningEffort: effort,
    effectiveReasoningEffort: effectiveReasoningEffort(effort, model.supportedEfforts),
    thinkingMode,
    effectiveThinkingMode: effectiveThinkingMode(thinkingMode, model.supportedThinkingModes),
    ...(thinkingTransport ? { thinkingTransport } : {}),
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {}),
    ...(supportsImages !== undefined ? { supportsImages } : {}),
    ...(model.generationConfig ? { generationConfig: model.generationConfig } : {}),
  }
}

async function resolveLegacyModel(config: ResolvedConfig, requested: string, providerName: string, modelName: string, effort: ReasoningEffort, thinkingMode: ThinkingMode) {
  const provider = config.providers?.[providerName]
  const model = provider?.models?.[modelName]
  if (!provider || !model) return null
  const baseUrl = provider.baseUrl?.trim()
  const apiKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv]?.trim() : undefined
  if (!baseUrl || !apiKey) throw new Error(`${requested} is missing baseUrl or credential environment variable ${provider.apiKeyEnv ?? "apiKeyEnv"}`)
  return { source: "config" as const, sourceLabel: config.sources.at(-1) ?? "configuration", preset: requested, provider: providerName, modelId: model.modelId ?? modelName, baseUrl, apiKey, protocol: "openai-compatible" as const, reasoningEffort: effort, effectiveReasoningEffort: effort, thinkingMode, effectiveThinkingMode: thinkingMode, ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}) }
}
