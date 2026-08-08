import { createInterface, emitKeypressEvents } from "node:readline"
import { stdin, stdout } from "node:process"
import { installProvider, type ProviderInstallInput } from "./provider-setup.js"
import { providerDefinition, providerRegistry, type ProviderDefinition } from "./provider-registry.js"
import type { ProviderProtocol } from "./config.js"

async function question(label: string) {
  const prompt = createInterface({ input: stdin, output: stdout })
  try { return (await new Promise<string>((resolve) => prompt.question(label, resolve))).trim() }
  finally { prompt.close() }
}

async function secretQuestion(label: string) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") return question(label)
  emitKeypressEvents(stdin)
  stdout.write(label)
  stdin.setRawMode(true)
  stdin.resume()
  let value = ""
  return await new Promise<string>((resolve, reject) => {
    const cleanup = () => { stdin.off("keypress", onKey); stdin.setRawMode(false); stdin.pause(); stdout.write("\n") }
    const onKey = (text: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
      if (key.ctrl && key.name === "c") { cleanup(); reject(new Error("已取消模型配置")); return }
      if (key.name === "return" || key.name === "enter") { cleanup(); resolve(value.trim()); return }
      if (key.name === "backspace") { if (value) { value = value.slice(0, -1); stdout.write("\b \b") }; return }
      if (!key.ctrl && text && !/[\x00-\x1f\x7f]/.test(text)) { value += text; stdout.write("•") }
    }
    stdin.on("keypress", onKey)
  })
}

function printProviders() {
  const groups: Array<[ProviderDefinition["group"], string]> = [["ark", "火山方舟"], ["alibaba", "阿里云百炼"], ["third-party", "其他中国模型服务"], ["custom", "自定义"]]
  let number = 1
  const numbered: ProviderDefinition[] = []
  for (const [group, label] of groups) {
    stdout.write(`\n${label}\n`)
    for (const item of providerRegistry.filter((provider) => provider.group === group)) {
      stdout.write(`  ${number}) ${item.label} — ${item.description}\n`)
      numbered.push(item); number += 1
    }
  }
  return numbered
}

function indexes(value: string, length: number) {
  if (!value) return Array.from({ length }, (_, index) => index)
  const selected = [...new Set(value.split(",").map((item) => Number(item.trim()) - 1))]
  if (selected.some((index) => !Number.isInteger(index) || index < 0 || index >= length)) throw new Error("模型序号无效")
  return selected
}

export async function runProviderSetupWizard() {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("do-code auth 需要在交互式终端中运行")
  stdout.write("\ndo-code 模型配置\n只需选择服务、填写 API Key 和模型；技术参数已使用推荐值。\n")
  const providers = printProviders()
  const providerAnswer = await question(`\n选择 Provider [1-${providers.length}]：`)
  const definition = providers[Number(providerAnswer) - 1]
  if (!definition) throw new Error("Provider 序号无效")
  const input: ProviderInstallInput = { providerId: definition.id, apiKey: "" }
  if (definition.id === "custom") {
    input.customProviderId = await question("Provider ID（例如 my-provider）：")
    stdout.write("  1) OpenAI-compatible\n  2) Anthropic\n  3) Gemini\n")
    const protocols: ProviderProtocol[] = ["openai-compatible", "anthropic", "gemini"]
    const protocol = protocols[Number(await question("选择协议 [1-3]：")) - 1]
    if (!protocol) throw new Error("协议序号无效")
    input.protocol = protocol
    input.baseUrl = await question("接口地址（Base URL）：")
  } else if (Array.isArray(definition.baseUrl)) {
    stdout.write(`\n${definition.baseUrl.map((item, index) => `  ${index + 1}) ${item.label} — ${item.url}`).join("\n")}\n`)
    const regionIndex = Number(await question(`选择区域 [1-${definition.baseUrl.length}，默认 1]：`) || "1") - 1
    if (!definition.baseUrl[regionIndex]) throw new Error("区域序号无效")
    input.regionId = definition.baseUrl[regionIndex]!.id
  }
  input.apiKey = await secretQuestion(`API Key${definition.apiKeyPlaceholder ? `（${definition.apiKeyPlaceholder}）` : ""}：`)
  const models = definition.models ?? []
  if (models.length) {
    stdout.write(`\n可用模型\n${models.map((item, index) => `  ${index + 1}) ${item.id}`).join("\n")}\n`)
    const selected = indexes(await question("选择模型（逗号分隔，直接回车安装全部）："), models.length)
    input.modelIds = selected.map((index) => models[index]!.id)
  } else {
    input.modelIds = (await question("模型 ID（多个用逗号分隔）：")).split(",").map((item) => item.trim()).filter(Boolean)
  }
  const plan = providerDefinition(definition.id)
  stdout.write(`\n即将安装：${plan?.label ?? definition.label}\n模型：${input.modelIds?.join(", ")}\nAPI Key：已填写（隐藏）\n`)
  const confirmed = (await question("确认安装？[Y/n]：")).toLowerCase()
  if (confirmed === "n" || confirmed === "no") throw new Error("已取消模型配置")
  const result = await installProvider(input)
  stdout.write(`\n配置完成\n默认模型：${result.defaultModel}\n配置文件：${result.file}\n运行 do-code 即可开始。\n`)
  return result
}
