import type { HookEvent, McpServerConfig, ProviderProtocol, ReasoningEffort, StoredConfig, ThinkingMode } from "./config-contracts.js"
import { migrateAgentProfiles } from "./config-agent-profile.js"
import { migrateModelProviders, migrateProviders } from "./config-provider-migration.js"

const EMPTY_CONFIG: StoredConfig = { version: 2 }
const REASONING_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"]
const THINKING_MODES: ThinkingMode[] = ["auto", "on", "off"]
const PROVIDER_PROTOCOLS: ProviderProtocol[] = ["openai-compatible", "anthropic", "gemini"]
const HOOK_EVENTS: HookEvent[] = ["sessionStart", "beforeModel", "beforeTool", "afterTool", "sessionEnd", "error"]

export function migrateConfig(value: unknown, source = "configuration"): StoredConfig {
  if (value === null || value === undefined) return { ...EMPTY_CONFIG }
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be a JSON object`)
  const raw = value as Record<string, unknown>
  if (raw.version !== undefined && raw.version !== 1 && raw.version !== 2) throw new Error(`${source}.version must be 1 or 2`)
  const config: StoredConfig = { version: 2 }
  if (typeof raw.defaultModel === "string") config.defaultModel = raw.defaultModel
  if (typeof raw.defaultAgent === "string") config.defaultAgent = raw.defaultAgent
  if (raw.defaultReasoningEffort !== undefined) {
    if (!REASONING_EFFORTS.includes(String(raw.defaultReasoningEffort) as ReasoningEffort)) throw new Error(`${source}.defaultReasoningEffort is invalid`)
    config.defaultReasoningEffort = raw.defaultReasoningEffort as ReasoningEffort
  }
  if (raw.defaultThinkingMode !== undefined) {
    if (!THINKING_MODES.includes(String(raw.defaultThinkingMode) as ThinkingMode)) throw new Error(`${source}.defaultThinkingMode is invalid`)
    config.defaultThinkingMode = raw.defaultThinkingMode as ThinkingMode
  }
  if (raw.language !== undefined) {
    if (raw.language !== "en" && raw.language !== "zh") throw new Error(`${source}.language must be en or zh`)
    config.language = raw.language
  }
  if (raw.agents !== undefined) config.agents = migrateAgentProfiles(raw.agents, source)
  if (raw.providers !== undefined) config.providers = migrateProviders(raw.providers, source)
  if (raw.providerProtocol !== undefined) config.providerProtocol = migrateProviderProtocols(raw.providerProtocol, source)
  if (raw.env !== undefined) config.env = migrateEnvironment(raw.env, source)
  if (raw.modelProviders !== undefined) config.modelProviders = migrateModelProviders(raw.modelProviders, source)
  if (raw.hooks !== undefined) config.hooks = migrateHooks(raw.hooks, source)
  if (raw.mcpServers !== undefined) config.mcpServers = migrateMcpServers(raw.mcpServers, source)
  if (raw.sandbox && typeof raw.sandbox === "object") {
    const sandbox = raw.sandbox as Record<string, unknown>
    if (sandbox.type !== undefined && sandbox.type !== "local" && sandbox.type !== "container" && sandbox.type !== "seatbelt") throw new Error(`${source}.sandbox.type must be local, seatbelt, or container`)
    if (sandbox.network !== undefined && typeof sandbox.network !== "boolean" && !["none", "local", "full"].includes(String(sandbox.network))) throw new Error(`${source}.sandbox.network must be none, local, or full`)
    const network = typeof sandbox.network === "boolean" ? (sandbox.network ? "full" : "none") : sandbox.network
    config.sandbox = { ...(sandbox.type ? { type: sandbox.type as "local" | "container" | "seatbelt" } : {}), ...(typeof sandbox.image === "string" ? { image: sandbox.image } : {}), ...(typeof network === "string" ? { network: network as "none" | "local" | "full" } : {}) }
  }
  if (raw.subagents && typeof raw.subagents === "object") {
    const subagents = raw.subagents as Record<string, unknown>
    config.subagents = { ...(typeof subagents.enabled === "boolean" ? { enabled: subagents.enabled } : {}), ...(typeof subagents.maxDepth === "number" ? { maxDepth: Math.max(0, Math.floor(subagents.maxDepth)) } : {}) }
  }
  return config
}

function migrateProviderProtocols(value: unknown, source: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}.providerProtocol must be an object`)
  const protocols: Record<string, ProviderProtocol> = {}
  for (const [provider, protocol] of Object.entries(value as Record<string, unknown>)) {
    if (!PROVIDER_PROTOCOLS.includes(String(protocol) as ProviderProtocol)) throw new Error(`${source}.providerProtocol.${provider} is invalid`)
    protocols[provider] = protocol as ProviderProtocol
  }
  return protocols
}

function migrateEnvironment(value: unknown, source: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}.env must be an object`)
  const environment: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || typeof entry !== "string") throw new Error(`${source}.env.${key} is invalid`)
    environment[key] = entry
  }
  return environment
}

function migrateHooks(value: unknown, source: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}.hooks must be an object`)
  const hooks: Partial<Record<HookEvent, string[]>> = {}
  for (const event of HOOK_EVENTS) {
    const commands = (value as Record<string, unknown>)[event]
    if (commands !== undefined) hooks[event] = strings(commands, `${source}.hooks.${event}`)
  }
  return hooks
}

function migrateMcpServers(value: unknown, source: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}.mcpServers must be an object`)
  const servers: Record<string, McpServerConfig> = {}
  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") throw new Error(`${source}.mcpServers.${name} must be an object`)
    const server = entry as Record<string, unknown>
    if (typeof server.command !== "string" && typeof server.url !== "string") throw new Error(`${source}.mcpServers.${name} requires command or url`)
    if (server.command !== undefined && server.url !== undefined) throw new Error(`${source}.mcpServers.${name} must use either command or url, not both`)
    if (server.url !== undefined && (typeof server.url !== "string" || !/^https?:\/\//.test(server.url))) throw new Error(`${source}.mcpServers.${name}.url must be an HTTP(S) URL`)
    servers[name] = {
      ...(typeof server.command === "string" ? { command: server.command } : {}),
      ...(typeof server.url === "string" ? { url: server.url } : {}),
      ...(server.args !== undefined ? { args: strings(server.args, `${source}.mcpServers.${name}.args`) } : {}),
      ...(server.env && typeof server.env === "object" ? { env: stringRecord(server.env, `${source}.mcpServers.${name}.env`) } : {}),
      ...(server.headers && typeof server.headers === "object" ? { headers: stringRecord(server.headers, `${source}.mcpServers.${name}.headers`) } : {}),
      ...(typeof server.enabled === "boolean" ? { enabled: server.enabled } : {}),
    }
  }
  return servers
}

function strings(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be an array of strings`)
  return value as string[]
}

function stringRecord(value: unknown, label: string) {
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (typeof item !== "string") throw new Error(`${label}.${key} must be a string`)
    return [key, item]
  }))
}
