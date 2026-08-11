import { createInterface, emitKeypressEvents } from "node:readline"
import { stdin, stdout } from "node:process"
import { customProviderId, installProvider, resolveProviderSetupLanguage, type ProviderInstallInput } from "./provider-setup.js"
import { providerDefinition, providerRegistry, type ProviderDefinition } from "./provider-registry.js"
import type { DoCodeLanguage, ProviderProtocol } from "./config.js"
import { t } from "./ui/i18n.js"

async function question(label: string) {
  const prompt = createInterface({ input: stdin, output: stdout })
  try { return (await new Promise<string>((resolve) => prompt.question(label, resolve))).trim() }
  finally { prompt.close() }
}

async function secretQuestion(label: string, language: DoCodeLanguage) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") return question(label)
  emitKeypressEvents(stdin)
  stdout.write(label)
  stdin.setRawMode(true)
  stdin.resume()
  let value = ""
  return await new Promise<string>((resolve, reject) => {
    const cleanup = () => { stdin.off("keypress", onKey); stdin.setRawMode(false); stdin.pause(); stdout.write("\n") }
    const onKey = (text: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
      if (key.ctrl && key.name === "c") { cleanup(); reject(new Error(t(language, "Model configuration cancelled."))); return }
      if (key.name === "return" || key.name === "enter") { cleanup(); resolve(value.trim()); return }
      if (key.name === "backspace") { if (value) { value = value.slice(0, -1); stdout.write("\b \b") }; return }
      if (!key.ctrl && text && !/[\x00-\x1f\x7f]/.test(text)) { value += text; stdout.write("•") }
    }
    stdin.on("keypress", onKey)
  })
}

const providerText: Record<string, { label: string; description: string }> = {
  "ark-coding-plan": { label: "Volcengine Ark Coding Plan", description: "Volcengine Ark plan models for coding agents" },
  "coding-plan": { label: "Alibaba ModelStudio Coding Plan", description: "Individual developer plan with weekly quota" },
  "alibaba-standard": { label: "Alibaba ModelStudio Standard API", description: "Use an existing pay-as-you-go ModelStudio API Key" },
  "token-plan": { label: "Alibaba ModelStudio Token Plan", description: "Team and enterprise plan with a dedicated endpoint" },
  deepseek: { label: "DeepSeek API", description: "Official DeepSeek API" },
  minimax: { label: "MiniMax API", description: "Official MiniMax API" },
  zai: { label: "Z.AI API", description: "Z.AI Standard API or Coding Plan" },
  modelscope: { label: "ModelScope", description: "ModelScope API-Inference" },
  custom: { label: "Custom Provider", description: "Connect a local model, proxy, or a service not built in yet" },
}

const regionText: Record<string, string> = {
  aliyun: "China (Beijing)", alibabacloud: "Singapore (International)", "cn-beijing": "China (Beijing)",
  "sg-singapore": "Singapore", "us-virginia": "United States (Virginia)", "cn-hongkong": "China (Hong Kong)",
  "ap-southeast-1": "Singapore (International)", china: "China", international: "International", standard: "Standard API", "coding-plan": "Coding Plan",
}

function localizedProviderLabel(language: DoCodeLanguage, definition: ProviderDefinition) {
  return t(language, providerText[definition.id]?.label ?? definition.label)
}

function localizedProviderDescription(language: DoCodeLanguage, definition: ProviderDefinition) {
  return t(language, providerText[definition.id]?.description ?? definition.description)
}

function localizedRegionLabel(language: DoCodeLanguage, id: string, fallback: string) {
  return t(language, regionText[id] ?? fallback)
}

function printProviders(language: DoCodeLanguage) {
  const groups: Array<[ProviderDefinition["group"], string]> = [["ark", "Volcengine Ark"], ["alibaba", "Alibaba ModelStudio"], ["third-party", "Third-party Providers"], ["custom", "Custom"]]
  let number = 1
  const numbered: ProviderDefinition[] = []
  for (const [group, label] of groups) {
    stdout.write(`\n${t(language, label)}\n`)
    for (const item of providerRegistry.filter((provider) => provider.group === group)) {
      stdout.write(`  ${number}) ${localizedProviderLabel(language, item)} — ${localizedProviderDescription(language, item)}\n`)
      numbered.push(item); number += 1
    }
  }
  return numbered
}

function indexes(value: string, length: number, language: DoCodeLanguage) {
  if (!value) return Array.from({ length }, (_, index) => index)
  const selected = [...new Set(value.split(",").map((item) => Number(item.trim()) - 1))]
  if (selected.some((index) => !Number.isInteger(index) || index < 0 || index >= length)) throw new Error(t(language, "Invalid model number."))
  return selected
}

export async function runProviderSetupWizard(requestedLanguage?: DoCodeLanguage) {
  const language = requestedLanguage ?? await resolveProviderSetupLanguage()
  if (!stdin.isTTY || !stdout.isTTY) throw new Error(t(language, "do-code auth must run in an interactive terminal."))
  stdout.write(`\n${t(language, "do-code Model Setup")}\n${t(language, "Choose a service, enter an API Key and select models. Recommended technical settings are already applied.")}\n`)
  const providers = printProviders(language)
  const providerAnswer = await question(`\n${t(language, "Select Provider [1-{count}]:", { count: providers.length })}`)
  const definition = providers[Number(providerAnswer) - 1]
  if (!definition) throw new Error(t(language, "Invalid Provider number."))
  const input: ProviderInstallInput = { providerId: definition.id, apiKey: "" }
  if (definition.id === "custom") {
    stdout.write(`  1) OpenAI-compatible\n  2) Anthropic\n  3) Gemini\n`)
    const protocols: ProviderProtocol[] = ["openai-compatible", "anthropic", "gemini"]
    const protocol = protocols[Number(await question(t(language, "Select protocol [1-3]:"))) - 1]
    if (!protocol) throw new Error(t(language, "Invalid protocol number."))
    input.protocol = protocol
    input.baseUrl = await question(t(language, "Base URL:"))
    input.customProviderId = customProviderId(input.baseUrl)
  } else if (Array.isArray(definition.baseUrl)) {
    stdout.write(`\n${definition.baseUrl.map((item, index) => `  ${index + 1}) ${localizedRegionLabel(language, item.id, item.label)} — ${item.url}`).join("\n")}\n`)
    const regionIndex = Number(await question(t(language, "Select region [1-{count}, default 1]:", { count: definition.baseUrl.length })) || "1") - 1
    if (!definition.baseUrl[regionIndex]) throw new Error(t(language, "Invalid region number."))
    input.regionId = definition.baseUrl[regionIndex]!.id
  }
  input.apiKey = await secretQuestion(`${t(language, "API Key")}${definition.apiKeyPlaceholder ? ` (${definition.apiKeyPlaceholder})` : ""}:`, language)
  const models = definition.models ?? []
  if (models.length) {
    stdout.write(`\n${t(language, "Available models")}\n${models.map((item, index) => `  ${index + 1}) ${item.id}`).join("\n")}\n`)
    const selected = indexes(await question(t(language, "Select models (comma-separated; press Enter to install all):")), models.length, language)
    input.modelIds = selected.map((index) => models[index]!.id)
  } else {
    input.modelIds = (await question(t(language, "Model IDs (comma-separated):"))).split(",").map((item) => item.trim()).filter(Boolean)
  }
  const plan = providerDefinition(definition.id)
  stdout.write(`\n${t(language, "About to install: {provider}", { provider: localizedProviderLabel(language, plan ?? definition) })}\n${t(language, "Models: {models}", { models: input.modelIds?.join(", ") ?? "" })}\n${t(language, "API Key: entered (hidden)")}\n`)
  const confirmed = (await question(t(language, "Confirm installation? [Y/n]:"))).toLowerCase()
  if (confirmed === "n" || confirmed === "no") throw new Error(t(language, "Model configuration cancelled."))
  const result = await installProvider(input, language)
  stdout.write(`\n${t(language, "Setup complete")}\n${t(language, "Default model: {model}", { model: result.defaultModel ?? "" })}\n${t(language, "Configuration file: {file}", { file: result.file })}\n${t(language, "Run do-code to get started.")}\n`)
  return result
}
