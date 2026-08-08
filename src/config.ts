import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ApprovalMode } from "./policy.js"

export type ProviderConfig = {
  baseUrl?: string
  apiKeyEnv?: string
  credential?: { source: "opencode" | "qwen"; provider?: string }
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
  credential?: { source: "opencode" | "qwen"; provider?: string }
  contextWindow?: number
  maxOutputTokens?: number
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

export type SandboxNetworkMode = "none" | "local" | "full"
export type DoCodeLanguage = "en" | "zh"

export type StoredConfig = {
  version: 2
  defaultModel?: string
  defaultAgent?: string
  language?: DoCodeLanguage
  agents?: Record<string, AgentProfileConfig>
  model?: { source: "opencode" }
  providers?: Record<string, ProviderConfig>
  /** Qwen Code style registry. Provider IDs map to a list of selectable models. */
  modelProviders?: Record<string, ModelProviderModelConfig[]>
  /** Custom provider IDs explicitly select one of the three stable protocol adapters. */
  providerProtocol?: Record<string, ProviderProtocol>
  /** Qwen Code compatible local secret store. Never expose this object through public APIs. */
  env?: Record<string, string>
  defaultReasoningEffort?: ReasoningEffort
  defaultThinkingMode?: ThinkingMode
  hooks?: Partial<Record<HookEvent, string[]>>
  mcpServers?: Record<string, McpServerConfig>
  sandbox?: { type?: "local" | "container" | "seatbelt"; image?: string; network?: SandboxNetworkMode }
  subagents?: { enabled?: boolean; maxDepth?: number }
}

export type RuntimeModelConfig = {
  source: "environment" | "opencode" | "config"
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
  generationConfig?: ModelProviderModelConfig["generationConfig"]
}

export type ResolvedConfig = StoredConfig & {
  sources: string[]
}

type OpenCodeConfig = {
  provider?: Record<string, {
    models?: Record<string, { name?: string }>
    options?: { apiKey?: string; baseURL?: string }
  }>
}

type QwenCodeConfig = {
  env?: Record<string, string>
  modelProviders?: Record<string, Array<{
    id?: string
    baseUrl?: string
  }>>
}

const EMPTY: StoredConfig = { version: 2 }

export function doCodeConfigPath() {
  return process.env.DO_CODE_CONFIG_PATH ?? path.join(os.homedir(), ".config", "do-code", "config.json")
}

export function projectConfigPath(workspace: string) {
  return path.join(path.resolve(workspace), ".do-code", "config.json")
}

export function systemConfigPath() {
  if (process.env.DO_CODE_SYSTEM_CONFIG_PATH) return process.env.DO_CODE_SYSTEM_CONFIG_PATH
  return process.platform === "darwin"
    ? "/Library/Application Support/do-code/config.json"
    : process.platform === "win32"
      ? "C:\\ProgramData\\do-code\\config.json"
      : "/etc/do-code/config.json"
}

export function openCodeConfigPath() {
  return process.env.OPENCODE_CONFIG_PATH ?? path.join(os.homedir(), ".config", "opencode", "opencode.json")
}

export function qwenCodeConfigPath() {
  return process.env.QWEN_CODE_CONFIG_PATH ?? path.join(os.homedir(), ".qwen", "settings.json")
}

function resolveSecret(value: string) {
  const match = /^\{env:([^}]+)\}$/.exec(value.trim())
  return match ? process.env[match[1]!] ?? "" : value
}

async function readJson(file: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(file, "utf8")) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw new Error(`Cannot read configuration ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function strings(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be an array of strings`)
  return value as string[]
}

export function migrateConfig(value: unknown, source = "configuration"): StoredConfig {
  if (value === null || value === undefined) return { ...EMPTY }
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be a JSON object`)
  const raw = value as Record<string, unknown>
  if (raw.version !== undefined && raw.version !== 1 && raw.version !== 2) throw new Error(`${source}.version must be 1 or 2`)
  const config: StoredConfig = { version: 2 }
  if (typeof raw.defaultModel === "string") config.defaultModel = raw.defaultModel
  if (typeof raw.defaultAgent === "string") config.defaultAgent = raw.defaultAgent
  if (raw.defaultReasoningEffort !== undefined) {
    if (!["low", "medium", "high", "xhigh", "max"].includes(String(raw.defaultReasoningEffort))) throw new Error(`${source}.defaultReasoningEffort is invalid`)
    config.defaultReasoningEffort = raw.defaultReasoningEffort as ReasoningEffort
  }
  if (raw.defaultThinkingMode !== undefined) {
    if (!["auto", "on", "off"].includes(String(raw.defaultThinkingMode))) throw new Error(`${source}.defaultThinkingMode is invalid`)
    config.defaultThinkingMode = raw.defaultThinkingMode as ThinkingMode
  }
  if (raw.language !== undefined) {
    if (raw.language !== "en" && raw.language !== "zh") throw new Error(`${source}.language must be en or zh`)
    config.language = raw.language
  }
  if (raw.agents !== undefined) {
    if (!raw.agents || typeof raw.agents !== "object" || Array.isArray(raw.agents)) throw new Error(`${source}.agents must be an object`)
    config.agents = {}
    for (const [name, value] of Object.entries(raw.agents as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}.agents.${name} must be an object`)
      const agent = value as Record<string, unknown>
      if (agent.approvalMode !== undefined && !["ask", "auto", "full-access"].includes(String(agent.approvalMode))) throw new Error(`${source}.agents.${name}.approvalMode is invalid`)
      if (agent.maxSteps !== undefined && (!Number.isInteger(agent.maxSteps) || Number(agent.maxSteps) < 1)) throw new Error(`${source}.agents.${name}.maxSteps must be a positive integer`)
      const toolRules = agent.tools as Record<string, unknown> | undefined
      config.agents[name] = {
        ...(typeof agent.model === "string" ? { model: agent.model } : {}),
        ...(typeof agent.approvalMode === "string" ? { approvalMode: agent.approvalMode as ApprovalMode } : {}),
        ...(typeof agent.instructions === "string" ? { instructions: agent.instructions } : {}),
        ...(typeof agent.maxSteps === "number" ? { maxSteps: agent.maxSteps } : {}),
        ...(toolRules && typeof toolRules === "object" ? { tools: { ...(toolRules.allow !== undefined ? { allow: strings(toolRules.allow, `${source}.agents.${name}.tools.allow`) } : {}), ...(toolRules.deny !== undefined ? { deny: strings(toolRules.deny, `${source}.agents.${name}.tools.deny`) } : {}) } } : {}),
      }
    }
  }
  if (raw.model && typeof raw.model === "object" && (raw.model as Record<string, unknown>).source === "opencode") config.model = { source: "opencode" }
  if (raw.providers !== undefined) {
    if (typeof raw.providers !== "object" || raw.providers === null || Array.isArray(raw.providers)) throw new Error(`${source}.providers must be an object`)
    config.providers = {}
    for (const [name, item] of Object.entries(raw.providers as Record<string, unknown>)) {
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
      if (provider.credential !== undefined) {
        const credential = provider.credential as Record<string, unknown>
        if (!credential || (credential.source !== "opencode" && credential.source !== "qwen")) throw new Error(`${source}.providers.${name}.credential must use opencode or qwen`)
        normalized.credential = { source: credential.source, ...(typeof credential.provider === "string" ? { provider: credential.provider } : {}) }
      }
      if (provider.models !== undefined) {
        if (!provider.models || typeof provider.models !== "object" || Array.isArray(provider.models)) throw new Error(`${source}.providers.${name}.models must be an object`)
        normalized.models = {}
        for (const [preset, modelValue] of Object.entries(provider.models as Record<string, unknown>)) {
          if (!modelValue || typeof modelValue !== "object" || Array.isArray(modelValue)) throw new Error(`${source}.providers.${name}.models.${preset} must be an object`)
          const model = modelValue as Record<string, unknown>
          if (model.modelId !== undefined && typeof model.modelId !== "string") throw new Error(`${source}.providers.${name}.models.${preset}.modelId must be a string`)
          if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || Number(model.contextWindow) < 1024)) throw new Error(`${source}.providers.${name}.models.${preset}.contextWindow is invalid`)
          normalized.models[preset] = { ...(typeof model.modelId === "string" ? { modelId: model.modelId } : {}), ...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}) }
        }
      }
      config.providers[name] = normalized
    }
  }
  if (raw.providerProtocol !== undefined) {
    if (!raw.providerProtocol || typeof raw.providerProtocol !== "object" || Array.isArray(raw.providerProtocol)) throw new Error(`${source}.providerProtocol must be an object`)
    config.providerProtocol = {}
    for (const [provider, protocol] of Object.entries(raw.providerProtocol as Record<string, unknown>)) {
      if (!["openai-compatible", "anthropic", "gemini"].includes(String(protocol))) throw new Error(`${source}.providerProtocol.${provider} is invalid`)
      config.providerProtocol[provider] = protocol as ProviderProtocol
    }
  }
  if (raw.env !== undefined) {
    if (!raw.env || typeof raw.env !== "object" || Array.isArray(raw.env)) throw new Error(`${source}.env must be an object`)
    config.env = {}
    for (const [key, value] of Object.entries(raw.env as Record<string, unknown>)) {
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || typeof value !== "string") throw new Error(`${source}.env.${key} is invalid`)
      config.env[key] = value
    }
  }
  if (raw.modelProviders !== undefined) {
    if (!raw.modelProviders || typeof raw.modelProviders !== "object" || Array.isArray(raw.modelProviders)) throw new Error(`${source}.modelProviders must be an object`)
    config.modelProviders = {}
    for (const [provider, modelsValue] of Object.entries(raw.modelProviders as Record<string, unknown>)) {
      if (!Array.isArray(modelsValue)) throw new Error(`${source}.modelProviders.${provider} must be an array`)
      config.modelProviders[provider] = modelsValue.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}.modelProviders.${provider}.${index} must be an object`)
        const model = value as Record<string, unknown>
        if (typeof model.id !== "string" || !model.id.trim()) throw new Error(`${source}.modelProviders.${provider}.${index}.id is required`)
        if (model.baseUrl !== undefined && (typeof model.baseUrl !== "string" || !/^https?:\/\//.test(model.baseUrl))) throw new Error(`${source}.modelProviders.${provider}.${index}.baseUrl must be an HTTP(S) URL`)
        if (model.envKey !== undefined && (typeof model.envKey !== "string" || !/^[A-Z_][A-Z0-9_]*$/i.test(model.envKey))) throw new Error(`${source}.modelProviders.${provider}.${index}.envKey is invalid`)
        const credential=model.credential
        const credentialSource = credential && typeof credential === "object" && !Array.isArray(credential) ? (credential as Record<string,unknown>).source : undefined
        if(credential!==undefined&&(!credential||typeof credential!=="object"||Array.isArray(credential)||(credentialSource!=="opencode"&&credentialSource!=="qwen")))throw new Error(`${source}.modelProviders.${provider}.${index}.credential is invalid`)
        const supportedEfforts = model.supportedEfforts === undefined ? undefined : strings(model.supportedEfforts, `${source}.modelProviders.${provider}.${index}.supportedEfforts`) as ReasoningEffort[]
        if (supportedEfforts?.some((item) => !["low", "medium", "high", "xhigh", "max"].includes(item))) throw new Error(`${source}.modelProviders.${provider}.${index}.supportedEfforts is invalid`)
        const supportedThinkingModes = model.supportedThinkingModes === undefined ? undefined : strings(model.supportedThinkingModes, `${source}.modelProviders.${provider}.${index}.supportedThinkingModes`) as ThinkingMode[]
        if (supportedThinkingModes?.some((item) => !["auto", "on", "off"].includes(item))) throw new Error(`${source}.modelProviders.${provider}.${index}.supportedThinkingModes is invalid`)
        if (model.thinkingTransport !== undefined && !["reasoning-effort", "glm-thinking", "deepseek-thinking", "enable-thinking"].includes(String(model.thinkingTransport))) throw new Error(`${source}.modelProviders.${provider}.${index}.thinkingTransport is invalid`)
        const generation = model.generationConfig
        if (generation !== undefined && (!generation || typeof generation !== "object" || Array.isArray(generation))) throw new Error(`${source}.modelProviders.${provider}.${index}.generationConfig must be an object`)
        if (generation) {
          for (const key of ["timeoutMs", "streamIdleTimeoutMs", "maxRetries"] as const) {
            const current = (generation as Record<string, unknown>)[key]
            if (current !== undefined && (!Number.isInteger(current) || Number(current) < 0)) throw new Error(`${source}.modelProviders.${provider}.${index}.generationConfig.${key} must be a non-negative integer`)
          }
        }
        return {
          id: model.id.trim(),
          ...(typeof model.name === "string" ? { name: model.name } : {}),
          ...(typeof model.baseUrl === "string" ? { baseUrl: model.baseUrl } : {}),
          ...(typeof model.envKey === "string" ? { envKey: model.envKey } : {}),
          ...(credential ? { credential:{source:credentialSource as "opencode"|"qwen",...(typeof (credential as Record<string,unknown>).provider==="string"?{provider:String((credential as Record<string,unknown>).provider)}:{})} } : {}),
          ...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
          ...(typeof model.maxOutputTokens === "number" ? { maxOutputTokens: model.maxOutputTokens } : {}),
          ...(supportedEfforts ? { supportedEfforts } : {}),
          ...(supportedThinkingModes ? { supportedThinkingModes } : {}),
          ...(typeof model.thinkingTransport === "string" ? { thinkingTransport: model.thinkingTransport as ThinkingTransport } : {}),
          ...(generation ? { generationConfig: generation as NonNullable<ModelProviderModelConfig["generationConfig"]> } : {}),
        }
      })
    }
  }
  if (raw.hooks !== undefined) {
    if (!raw.hooks || typeof raw.hooks !== "object" || Array.isArray(raw.hooks)) throw new Error(`${source}.hooks must be an object`)
    config.hooks = {}
    for (const event of ["sessionStart", "beforeModel", "beforeTool", "afterTool", "sessionEnd", "error"] as HookEvent[]) {
      const commands = (raw.hooks as Record<string, unknown>)[event]
      if (commands !== undefined) config.hooks[event] = strings(commands, `${source}.hooks.${event}`)
    }
  }
  if (raw.mcpServers !== undefined) {
    if (!raw.mcpServers || typeof raw.mcpServers !== "object" || Array.isArray(raw.mcpServers)) throw new Error(`${source}.mcpServers must be an object`)
    config.mcpServers = {}
    for (const [name, value] of Object.entries(raw.mcpServers as Record<string, unknown>)) {
      if (!value || typeof value !== "object") throw new Error(`${source}.mcpServers.${name} must be an object`)
      const server = value as Record<string, unknown>
      if (typeof server.command !== "string" && typeof server.url !== "string") throw new Error(`${source}.mcpServers.${name} requires command or url`)
      if (server.command !== undefined && server.url !== undefined) throw new Error(`${source}.mcpServers.${name} must use either command or url, not both`)
      if (server.url !== undefined && (typeof server.url !== "string" || !/^https?:\/\//.test(server.url))) throw new Error(`${source}.mcpServers.${name}.url must be an HTTP(S) URL`)
      const stringRecord = (input: unknown, label: string) => Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([key, item]) => {
        if (typeof item !== "string") throw new Error(`${label}.${key} must be a string`)
        return [key, item]
      }))
      config.mcpServers[name] = { ...(typeof server.command === "string" ? { command: server.command } : {}), ...(typeof server.url === "string" ? { url: server.url } : {}), ...(server.args !== undefined ? { args: strings(server.args, `${source}.mcpServers.${name}.args`) } : {}), ...(server.env && typeof server.env === "object" ? { env: stringRecord(server.env, `${source}.mcpServers.${name}.env`) } : {}), ...(server.headers && typeof server.headers === "object" ? { headers: stringRecord(server.headers, `${source}.mcpServers.${name}.headers`) } : {}), ...(typeof server.enabled === "boolean" ? { enabled: server.enabled } : {}) }
    }
  }
  if (raw.sandbox && typeof raw.sandbox === "object") {
    const sandbox = raw.sandbox as Record<string, unknown>
    if (sandbox.type !== undefined && sandbox.type !== "local" && sandbox.type !== "container" && sandbox.type !== "seatbelt") throw new Error(`${source}.sandbox.type must be local, seatbelt, or container`)
    if (sandbox.network !== undefined && typeof sandbox.network !== "boolean" && !["none", "local", "full"].includes(String(sandbox.network))) throw new Error(`${source}.sandbox.network must be none, local, or full`)
    const network = typeof sandbox.network === "boolean" ? (sandbox.network ? "full" : "none") : sandbox.network
    config.sandbox = { ...(sandbox.type ? { type: sandbox.type as "local" | "container" | "seatbelt" } : {}), ...(typeof sandbox.image === "string" ? { image: sandbox.image } : {}), ...(typeof network === "string" ? { network: network as SandboxNetworkMode } : {}) }
  }
  if (raw.subagents && typeof raw.subagents === "object") {
    const subagents = raw.subagents as Record<string, unknown>
    config.subagents = { ...(typeof subagents.enabled === "boolean" ? { enabled: subagents.enabled } : {}), ...(typeof subagents.maxDepth === "number" ? { maxDepth: Math.max(0, Math.floor(subagents.maxDepth)) } : {}) }
  }
  return config
}

function mergeConfig(base: StoredConfig, overlay: StoredConfig): StoredConfig {
  return {
    version: 2,
    ...(base.defaultModel ? { defaultModel: base.defaultModel } : {}),
    ...(overlay.defaultModel ? { defaultModel: overlay.defaultModel } : {}),
    ...(base.defaultAgent ? { defaultAgent: base.defaultAgent } : {}),
    ...(overlay.defaultAgent ? { defaultAgent: overlay.defaultAgent } : {}),
    ...(base.defaultReasoningEffort ? { defaultReasoningEffort: base.defaultReasoningEffort } : {}),
    ...(overlay.defaultReasoningEffort ? { defaultReasoningEffort: overlay.defaultReasoningEffort } : {}),
    ...(base.defaultThinkingMode ? { defaultThinkingMode: base.defaultThinkingMode } : {}),
    ...(overlay.defaultThinkingMode ? { defaultThinkingMode: overlay.defaultThinkingMode } : {}),
    ...(base.language ? { language: base.language } : {}),
    ...(overlay.language ? { language: overlay.language } : {}),
    agents: { ...base.agents, ...overlay.agents },
    ...(base.model ? { model: base.model } : {}),
    ...(overlay.model ? { model: overlay.model } : {}),
    providers: mergeProviders(base.providers, overlay.providers),
    modelProviders: { ...base.modelProviders, ...overlay.modelProviders },
    providerProtocol: { ...base.providerProtocol, ...overlay.providerProtocol },
    env: { ...base.env, ...overlay.env },
    hooks: { ...base.hooks, ...overlay.hooks },
    mcpServers: { ...base.mcpServers, ...overlay.mcpServers },
    sandbox: { ...base.sandbox, ...overlay.sandbox },
    subagents: { ...base.subagents, ...overlay.subagents },
  }
}

function mergeProviders(base?: Record<string, ProviderConfig>, overlay?: Record<string, ProviderConfig>) {
  const result: Record<string, ProviderConfig> = { ...base }
  for (const [name, provider] of Object.entries(overlay ?? {})) result[name] = { ...result[name], ...provider, models: { ...result[name]?.models, ...provider.models } }
  return result
}

export async function loadStoredConfig(workspace = process.cwd()): Promise<ResolvedConfig> {
  const layers = [systemConfigPath(), doCodeConfigPath(), projectConfigPath(workspace)]
  let config: StoredConfig = { ...EMPTY }
  const sources: string[] = []
  for (const file of layers) {
    const value = await readJson(file)
    if (value !== null) {
      config = mergeConfig(config, migrateConfig(value, file))
      sources.push(file)
    }
  }
  return { ...config, sources }
}

export async function loadOpenCodeArkConfig(configPath = openCodeConfigPath(), providerName?: string, modelName?: string): Promise<RuntimeModelConfig | null> {
  const config = JSON.parse(await readFile(configPath, "utf8")) as OpenCodeConfig
  const name = providerName ?? (config.provider?.["coding-plan"] ? "coding-plan" : "ark-coding-plan")
  const provider = config.provider?.[name]
  const selectedModel = modelName ?? (provider?.models?.["glm-5.2"] ? "glm-5.2" : Object.keys(provider?.models ?? {})[0])
  const apiKey = resolveSecret(provider?.options?.apiKey ?? "")
  const baseUrl = provider?.options?.baseURL?.trim() ?? ""
  if (!provider || !selectedModel || !provider.models?.[selectedModel] || !apiKey || !/^https?:\/\//.test(baseUrl)) return null
  return { source: "opencode", sourceLabel: configPath, preset: `opencode/${selectedModel}`, provider: "opencode", modelId: selectedModel, baseUrl, apiKey, protocol: "openai-compatible", reasoningEffort: "medium", effectiveReasoningEffort: "medium", thinkingMode: "auto", effectiveThinkingMode: "auto" }
}

export async function loadQwenCodeModelConfig(configPath = qwenCodeConfigPath(), envKey?: string, modelName?: string): Promise<Pick<RuntimeModelConfig, "apiKey" | "baseUrl" | "modelId"> | null> {
  const config = JSON.parse(await readFile(configPath, "utf8")) as QwenCodeConfig
  const candidates = Object.values(config.modelProviders ?? {}).flat()
  const model = modelName ? candidates.find((item) => item.id === modelName) : candidates[0]
  const apiKey = resolveSecret(envKey ? config.env?.[envKey] ?? "" : "")
  const baseUrl = model?.baseUrl?.trim() ?? ""
  if (!model?.id || !apiKey || !/^https?:\/\//.test(baseUrl)) return null
  return { apiKey, baseUrl, modelId: model.id }
}

export async function importOpenCodeConfig() {
  const runtime = await loadOpenCodeArkConfig()
  if (!runtime) throw new Error(`No usable Ark model configuration found in ${openCodeConfigPath()}`)
  const file = doCodeConfigPath()
  const existing = migrateConfig(await readJson(file), file)
  const imported = mergeConfig(existing, {
    version: 2,
    defaultModel: "ark/glm-5.2",
    model: { source: "opencode" },
    providers: { ark: { credential: { source: "opencode", provider: "coding-plan" }, models: { "glm-5.2": { modelId: "glm-5.2", contextWindow: 128_000 } } } },
  })
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(imported, null, 2)}\n`, { mode: 0o600 })
  return { file, runtime }
}

export function listModelPresets(config: StoredConfig) {
  const modern = Object.entries(config.modelProviders ?? {}).flatMap(([provider, models]) => models.map((model) => `${provider}/${model.id}`))
  const legacy = Object.entries(config.providers ?? {}).flatMap(([provider, value]) => Object.keys(value.models ?? {}).map((model) => `${provider}/${model}`))
  return [...new Set([...modern, ...legacy])]
}

export function modelProvidersPublic(config: StoredConfig) {
  return Object.entries(config.modelProviders ?? {}).map(([id, models]) => ({
    id,
    protocol: config.providerProtocol?.[id] ?? "openai-compatible" as ProviderProtocol,
    models: models.map((model) => ({ ...model, credentialAvailable: Boolean(model.credential?.source === "opencode" || model.credential?.source === "qwen" || model.envKey && (process.env[model.envKey] || config.env?.[model.envKey])) })),
  }))
}

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

function resolveThinkingTransport(model: ModelProviderModelConfig, baseUrl: string): ThinkingTransport | undefined {
  if (model.thinkingTransport) return model.thinkingTransport
  // Ark's OpenAI-compatible Coding endpoint exposes the unified
  // reasoning_effort switch even for GLM models. The native GLM
  // thinking.enabled shape is accepted but ignored by this gateway.
  if (/ark\.cn-[^.]+\.volces\.com/i.test(baseUrl)) return "reasoning-effort"
  return undefined
}

export function resolveAgentProfile(config: StoredConfig, requested?: string) {
  const name = requested ?? process.env.DO_CODE_AGENT?.trim() ?? config.defaultAgent
  if (!name) return null
  const profile = config.agents?.[name]
  if (!profile) throw new Error(`Unknown agent profile: ${name}. Available: ${Object.keys(config.agents ?? {}).join(", ") || "none"}`)
  return { name, ...profile }
}

export async function resolveRuntimeModelConfig(workspace = process.cwd(), requestedModel?: string, requestedProvider?: string, requestedEffort?: string, requestedThinkingMode?: string): Promise<RuntimeModelConfig> {
  const env = { apiKey: process.env.MODEL_API_KEY?.trim(), baseUrl: process.env.MODEL_BASE_URL?.trim(), modelId: process.env.MODEL_ID?.trim() }
  const config = await loadStoredConfig(workspace)
  const requested = requestedModel ?? process.env.DO_CODE_MODEL?.trim() ?? config.defaultModel
  const effort = normalizeReasoningEffort(requestedEffort ?? process.env.DO_CODE_REASONING_EFFORT) ?? config.defaultReasoningEffort ?? "medium"
  const thinkingMode = normalizeThinkingMode(requestedThinkingMode ?? process.env.DO_CODE_THINKING_MODE) ?? config.defaultThinkingMode ?? "auto"
  if (env.apiKey && env.baseUrl && env.modelId && !requestedProvider && !requestedModel) return { source: "environment", sourceLabel: "environment variables", preset: env.modelId, provider: "environment", apiKey: env.apiKey, baseUrl: env.baseUrl, modelId: env.modelId, protocol: "openai-compatible", reasoningEffort: effort, effectiveReasoningEffort: effort, thinkingMode, effectiveThinkingMode: thinkingMode }
  if (requested) {
    const [providerName, ...modelParts] = requested.includes("/") ? requested.split("/") : [requestedProvider ?? "", requested]
    const modelName = modelParts.join("/")
    const modernModel = config.modelProviders?.[providerName!]?.find((item) => item.id === modelName)
    if (modernModel) {
      const protocol = config.providerProtocol?.[providerName!] ?? "openai-compatible"
      let baseUrl = modernModel.baseUrl?.trim()
      let apiKey: string|undefined
      if(modernModel.credential?.source==="opencode"){
        const imported=await loadOpenCodeArkConfig(openCodeConfigPath(),modernModel.credential.provider,modernModel.id).catch(()=>null)
        apiKey=imported?.apiKey;baseUrl=baseUrl||imported?.baseUrl
      }else if(modernModel.credential?.source==="qwen"){
        const imported=await loadQwenCodeModelConfig(qwenCodeConfigPath(),modernModel.envKey,modernModel.id).catch(()=>null)
        apiKey=imported?.apiKey;baseUrl=baseUrl||imported?.baseUrl
      }else apiKey = modernModel.envKey ? process.env[modernModel.envKey]?.trim() || config.env?.[modernModel.envKey]?.trim() : undefined
      if (!baseUrl || !apiKey) throw new Error(`${requested} is missing baseUrl or credential environment variable ${modernModel.envKey ?? "envKey"}`)
      const thinkingTransport = resolveThinkingTransport(modernModel, baseUrl)
      return { source: "config", sourceLabel: config.sources.at(-1) ?? "configuration", preset: requested, provider: providerName!, modelId: modernModel.id, baseUrl, apiKey, protocol, reasoningEffort: effort, effectiveReasoningEffort: effectiveReasoningEffort(effort, modernModel.supportedEfforts), thinkingMode, effectiveThinkingMode: effectiveThinkingMode(thinkingMode, modernModel.supportedThinkingModes), ...(thinkingTransport ? { thinkingTransport } : {}), ...(modernModel.contextWindow ? { contextWindow: modernModel.contextWindow } : {}), ...(modernModel.maxOutputTokens ? { maxOutputTokens: modernModel.maxOutputTokens } : {}), ...(modernModel.generationConfig ? { generationConfig: modernModel.generationConfig } : {}) }
    }
    const provider = config.providers?.[providerName!]
    const model = provider?.models?.[modelName]
    if (!provider || !model) throw new Error(`Unknown model preset: ${requested}. Available: ${listModelPresets(config).join(", ") || "none"}`)
    if (provider.credential?.source === "opencode") {
      const opencode = await loadOpenCodeArkConfig(openCodeConfigPath(), provider.credential.provider, model.modelId ?? modelName).catch(() => null)
      if (!opencode) throw new Error(`Cannot read credentials for ${requested} from OpenCode`)
      return { ...opencode, source: "config", sourceLabel: config.sources.at(-1) ?? openCodeConfigPath(), preset: requested, provider: providerName!, modelId: model.modelId ?? modelName, protocol: "openai-compatible", reasoningEffort: effort, effectiveReasoningEffort: effort, thinkingMode, effectiveThinkingMode: thinkingMode, ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}) }
    }
    const baseUrl = provider.baseUrl?.trim()
    const apiKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv]?.trim() : undefined
    if (!baseUrl || !apiKey) throw new Error(`${requested} is missing baseUrl or credential environment variable ${provider.apiKeyEnv ?? "apiKeyEnv"}`)
    return { source: "config", sourceLabel: config.sources.at(-1) ?? "configuration", preset: requested, provider: providerName!, modelId: model.modelId ?? modelName, baseUrl, apiKey, protocol: "openai-compatible", reasoningEffort: effort, effectiveReasoningEffort: effort, thinkingMode, effectiveThinkingMode: thinkingMode, ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}) }
  }
  if (!config.model || config.model.source === "opencode") {
    const preset = await loadOpenCodeArkConfig().catch(() => null)
    if (preset) return { ...preset, reasoningEffort: effort, effectiveReasoningEffort: effort, thinkingMode, effectiveThinkingMode: thinkingMode }
  }
  throw new Error("No model is configured. Run do-code auth, or set MODEL_API_KEY, MODEL_BASE_URL, and MODEL_ID")
}

export async function saveMigratedConfig(workspace = process.cwd()) {
  const file = doCodeConfigPath()
  const config = await loadStoredConfig(workspace)
  const { sources: _sources, ...stored } = config
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 })
  await access(file)
  return file
}

export function normalizeLanguage(value: string): DoCodeLanguage | null {
  const normalized = value.trim().toLowerCase()
  if (["en", "en-us", "english", "英文"].includes(normalized)) return "en"
  if (["zh", "zh-cn", "chinese", "中文", "简体中文"].includes(normalized)) return "zh"
  return null
}

export function outputLanguageInstruction(language: DoCodeLanguage) {
  return language === "zh"
    ? "Respond to the user in Simplified Chinese. Keep code, identifiers, commands, file paths, and exact error messages unchanged when appropriate."
    : "Respond to the user in English. Keep code, identifiers, commands, file paths, and exact error messages unchanged when appropriate."
}

export async function saveLanguagePreference(language: DoCodeLanguage) {
  const file = doCodeConfigPath()
  const existing = migrateConfig(await readJson(file), file)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify({ ...existing, language }, null, 2)}\n`, { mode: 0o600 })
  return file
}
