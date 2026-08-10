import type { ProviderProtocol, StoredConfig } from "./config-contracts.js"

const DO_CODE_AGENT = "DO_CODE_AGENT"

export function listModelPresets(config: StoredConfig) {
  const modern = Object.entries(config.modelProviders ?? {}).flatMap(([provider, models]) => models.map((model) => `${provider}/${model.id}`))
  const legacy = Object.entries(config.providers ?? {}).flatMap(([provider, value]) => Object.keys(value.models ?? {}).map((model) => `${provider}/${model}`))
  return [...new Set([...modern, ...legacy])]
}

export function modelProvidersPublic(config: StoredConfig) {
  return Object.entries(config.modelProviders ?? {}).map(([id, models]) => ({
    id,
    protocol: config.providerProtocol?.[id] ?? "openai-compatible" as ProviderProtocol,
    models: models.map((model) => ({
      ...model,
      credentialAvailable: Boolean(model.envKey && (process.env[model.envKey] || config.env?.[model.envKey])),
    })),
  }))
}

export function resolveAgentProfile(config: StoredConfig, requested?: string) {
  const name = requested ?? process.env[DO_CODE_AGENT]?.trim() ?? config.defaultAgent
  if (!name) return null
  const profile = config.agents?.[name]
  if (!profile) throw new Error(`Unknown agent profile: ${name}. Available: ${Object.keys(config.agents ?? {}).join(", ") || "none"}`)
  return { name, ...profile }
}
