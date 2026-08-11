import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ProviderConfig, ResolvedConfig, StoredConfig } from "./config-contracts.js"
import { doCodeConfigPath, doCodeModelStatePath, projectConfigPath, systemConfigPath } from "./config-paths.js"
import { migrateConfig } from "./config-schema.js"

const EMPTY_CONFIG: StoredConfig = { version: 2 }
type RecentModel = { providerID: string; modelID: string }

export async function readConfigJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw new Error(`Cannot read configuration ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function mergeConfig(base: StoredConfig, overlay: StoredConfig): StoredConfig {
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

export async function loadStoredConfig(workspace = process.cwd()): Promise<ResolvedConfig> {
  const layers = [systemConfigPath(), doCodeConfigPath(), projectConfigPath(workspace)]
  let config: StoredConfig = { ...EMPTY_CONFIG }
  const sources: string[] = []
  for (const file of layers) {
    const value = await readConfigJson(file)
    if (value === null) continue
    config = mergeConfig(config, migrateConfig(value, file))
    sources.push(file)
  }
  return { ...config, sources }
}

export async function writeStoredConfig(file: string, config: StoredConfig) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
}

export async function saveMigratedConfig(workspace = process.cwd()) {
  const file = doCodeConfigPath()
  const config = await loadStoredConfig(workspace)
  const { sources: _sources, ...stored } = config
  await writeStoredConfig(file, stored)
  await access(file)
  return file
}

export async function saveDefaultModel(model: string) {
  const file = doCodeConfigPath()
  const existing = await readConfigJson(file)
  const stored = existing === null ? { ...EMPTY_CONFIG } : migrateConfig(existing, file)
  await writeStoredConfig(file, { ...stored, defaultModel: model })
  return file
}

export async function loadRecentModels() {
  const value = await readConfigJson(doCodeModelStatePath()).catch(() => null)
  if (!value || typeof value !== "object" || !Array.isArray((value as { recent?: unknown }).recent)) return []
  return (value as { recent: unknown[] }).recent.filter((item): item is RecentModel => {
    if (!item || typeof item !== "object") return false
    const candidate = item as Record<string, unknown>
    return typeof candidate.providerID === "string" && typeof candidate.modelID === "string"
  })
}

export async function rememberRecentModel(model: RecentModel) {
  const recent = await loadRecentModels()
  const next = [model, ...recent.filter((item) => item.providerID !== model.providerID || item.modelID !== model.modelID)].slice(0, 20)
  await mkdir(path.dirname(doCodeModelStatePath()), { recursive: true })
  await writeFile(doCodeModelStatePath(), `${JSON.stringify({ recent: next }, null, 2)}\n`, { mode: 0o600 })
}

function mergeProviders(base?: Record<string, ProviderConfig>, overlay?: Record<string, ProviderConfig>) {
  const result: Record<string, ProviderConfig> = { ...base }
  for (const [name, provider] of Object.entries(overlay ?? {})) {
    result[name] = { ...result[name], ...provider, models: { ...result[name]?.models, ...provider.models } }
  }
  return result
}
