import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { doCodeConfigPath, migrateConfig, type ModelProviderModelConfig, type ProviderProtocol } from "./config.js"
import { allReasoningEfforts, generateCustomEnvKey, providerDefinition } from "./provider-registry.js"

export type ProviderInstallInput = {
  providerId: string
  apiKey: string
  regionId?: string
  baseUrl?: string
  protocol?: ProviderProtocol
  modelIds?: string[]
  customProviderId?: string
  contextWindow?: number
  maxOutputTokens?: number
}

export function customProviderId(baseUrl: string) {
  try {
    const url = new URL(baseUrl.trim())
    const host = url.hostname.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
    const port = url.port ? `-${url.port}` : ""
    if (host) return `${host}${port}`
  } catch {}
  return "custom-provider"
}

async function readUserConfig(file = doCodeConfigPath()) {
  try { return migrateConfig(JSON.parse(await readFile(file, "utf8")), file) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return migrateConfig(null)
    throw error
  }
}

function resolveBaseUrl(input: ProviderInstallInput) {
  const definition = providerDefinition(input.providerId)
  if (!definition) throw new Error(`未知 Provider：${input.providerId}`)
  if (input.providerId === "custom") return input.baseUrl?.trim() ?? ""
  if (typeof definition.baseUrl === "string") return definition.baseUrl
  if (Array.isArray(definition.baseUrl)) return definition.baseUrl.find((item) => item.id === input.regionId)?.url ?? definition.baseUrl[0]?.url ?? ""
  return input.baseUrl?.trim() ?? ""
}

export function buildProviderInstall(input: ProviderInstallInput) {
  const definition = providerDefinition(input.providerId)
  if (!definition) throw new Error(`未知 Provider：${input.providerId}`)
  const apiKey = input.apiKey.trim()
  if (!apiKey) throw new Error("API Key 不能为空")
  if (definition.id === "coding-plan" && !apiKey.startsWith("sk-sp-")) throw new Error("百炼 Coding Plan API Key 应以 sk-sp- 开头")
  const baseUrl = resolveBaseUrl(input)
  if (!/^https?:\/\//.test(baseUrl)) throw new Error("接口地址必须是有效的 HTTP(S) URL")
  const protocol = input.protocol ?? definition.protocol
  if (!(definition.protocolOptions ?? [definition.protocol]).includes(protocol)) throw new Error("该 Provider 不支持所选协议")
  const providerId = definition.id === "custom" ? input.customProviderId?.trim() || customProviderId(baseUrl) : definition.id
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(providerId)) throw new Error("Provider ID 只能包含字母、数字、点、下划线和连字符")
  const requested = [...new Set((input.modelIds ?? definition.models?.map((item) => item.id) ?? []).map((item) => item.trim()).filter(Boolean))]
  if (!requested.length) throw new Error("至少选择一个模型")
  const envKey = definition.envKey ?? generateCustomEnvKey(protocol, baseUrl)
  const models: ModelProviderModelConfig[] = requested.map((id) => {
    const spec = definition.models?.find((item) => item.id === id)
    return {
      id, ...(spec?.name ? { name: spec.name } : {}), baseUrl, envKey,
      contextWindow: input.contextWindow ?? spec?.contextWindow ?? 128_000,
      ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
      supportedThinkingModes: spec?.thinking ? ["auto", "on", "off"] : ["auto", "off"],
      supportedEfforts: [...allReasoningEfforts],
      ...(spec?.thinkingTransport ? { thinkingTransport: spec.thinkingTransport } : {}),
    }
  })
  return { providerId, protocol, envKey, baseUrl, apiKey, models }
}

export async function installProvider(input: ProviderInstallInput) {
  const plan = buildProviderInstall(input)
  const file = doCodeConfigPath()
  const previous = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : Promise.reject(error))
  const current = await readUserConfig(file)
  const next = migrateConfig({
    ...current,
    env: { ...current.env, [plan.envKey]: plan.apiKey },
    modelProviders: { ...current.modelProviders, [plan.providerId]: plan.models },
    providerProtocol: { ...current.providerProtocol, [plan.providerId]: plan.protocol },
    defaultModel: current.defaultModel && !current.defaultModel.startsWith(`${plan.providerId}/`) ? current.defaultModel : `${plan.providerId}/${plan.models[0]!.id}`,
  }, file)
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await mkdir(path.dirname(file), { recursive: true })
  try {
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => {})
    if (previous === null) await unlink(file).catch(() => {})
    else await writeFile(file, previous, { mode: 0o600 })
    throw error
  }
  return { providerId: plan.providerId, protocol: plan.protocol, baseUrl: plan.baseUrl, models: plan.models.map((model) => model.id), defaultModel: next.defaultModel, file }
}
