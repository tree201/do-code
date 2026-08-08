import { createHash } from "node:crypto"
import type { ProviderProtocol, ThinkingTransport } from "./config.js"

export type ProviderRegion = { id: string; label: string; url: string; documentationUrl?: string }
export type ProviderModelSpec = { id: string; name?: string; contextWindow?: number; thinking?: boolean; thinkingTransport?: ThinkingTransport }
export type ProviderDefinition = {
  id: string
  label: string
  description: string
  group: "ark" | "alibaba" | "third-party" | "custom"
  protocol: ProviderProtocol
  protocolOptions?: ProviderProtocol[]
  baseUrl?: string | ProviderRegion[]
  envKey?: string
  models?: ProviderModelSpec[]
  modelsEditable: boolean
  showAdvancedConfig?: boolean
  apiKeyPlaceholder?: string
}

const efforts = ["low", "medium", "high", "xhigh", "max"] as const

export const providerRegistry: ProviderDefinition[] = [
  {
    id: "ark-coding-plan", label: "火山方舟 Coding Plan", description: "面向 Coding Agent 的火山方舟套餐模型", group: "ark",
    protocol: "openai-compatible", baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3", envKey: "ARK_CODING_PLAN_API_KEY", modelsEditable: true,
    models: ["deepseek-v4-flash", "deepseek-v4-pro", "doubao-seed-2.0-code", "doubao-seed-2.0-lite", "doubao-seed-2.0-pro", "doubao-seed-code", "glm-5.1", "glm-5.2", "kimi-k2.6", "minimax-m2.7", "minimax-m3"].map((id) => ({ id, contextWindow: 1_000_000, thinking: !id.includes("flash"), thinkingTransport: "reasoning-effort" })),
  },
  {
    id: "coding-plan", label: "阿里云百炼 Coding Plan", description: "个人开发者套餐，包含每周额度", group: "alibaba",
    protocol: "openai-compatible", envKey: "BAILIAN_CODING_PLAN_API_KEY", modelsEditable: true, apiKeyPlaceholder: "sk-sp-...",
    baseUrl: [
      { id: "aliyun", label: "中国（北京）", url: "https://coding.dashscope.aliyuncs.com/v1", documentationUrl: "https://help.aliyun.com/zh/model-studio/coding-plan" },
      { id: "alibabacloud", label: "新加坡（国际）", url: "https://coding-intl.dashscope.aliyuncs.com/v1" },
    ],
    models: ["qwen3.5-plus", "qwen3.6-plus", "qwen3.7-plus", "glm-5", "kimi-k2.5", "MiniMax-M2.5", "qwen3-coder-plus", "qwen3-coder-next", "qwen3-max-2026-01-23", "glm-4.7"].map((id) => ({ id, contextWindow: id.includes("qwen3.5") || id.includes("qwen3.6") || id.includes("qwen3.7") ? 1_000_000 : 262_144, thinking: !id.includes("coder"), thinkingTransport: "enable-thinking" })),
  },
  {
    id: "alibaba-standard", label: "阿里云百炼标准 API", description: "使用已有的百炼按量付费 API Key", group: "alibaba",
    protocol: "openai-compatible", envKey: "DASHSCOPE_API_KEY", modelsEditable: true,
    baseUrl: [
      { id: "cn-beijing", label: "中国（北京）", url: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
      { id: "sg-singapore", label: "新加坡", url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
      { id: "us-virginia", label: "美国（弗吉尼亚）", url: "https://dashscope-us.aliyuncs.com/compatible-mode/v1" },
      { id: "cn-hongkong", label: "中国（香港）", url: "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1" },
    ],
    models: ["qwen3.6-plus", "qwen3.7-plus", "qwen3.7-max", "glm-5.1", "deepseek-v4-pro", "deepseek-v4-flash"].map((id) => ({ id, contextWindow: 1_000_000, thinking: !id.includes("flash"), thinkingTransport: "enable-thinking" })),
  },
  {
    id: "token-plan", label: "阿里云百炼 Token Plan", description: "团队与企业套餐，使用专属接入地址", group: "alibaba",
    protocol: "openai-compatible", envKey: "BAILIAN_TOKEN_PLAN_API_KEY", modelsEditable: true,
    baseUrl: [
      { id: "cn-beijing", label: "中国（北京）", url: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" },
      { id: "ap-southeast-1", label: "新加坡（国际）", url: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" },
    ],
    models: ["qwen3.7-plus", "qwen3.6-plus", "qwen3.7-max", "qwen3.8-max-preview", "qwen3.6-flash", "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v3.2", "kimi-k2.7-code", "kimi-k2.6", "kimi-k2.5", "glm-5.2", "glm-5.1", "glm-5", "MiniMax-M2.5"].map((id) => ({ id, contextWindow: 1_000_000, thinking: !id.includes("flash"), thinkingTransport: "enable-thinking" })),
  },
  { id: "deepseek", label: "DeepSeek API", description: "DeepSeek 官方 API", group: "third-party", protocol: "openai-compatible", baseUrl: "https://api.deepseek.com", envKey: "DEEPSEEK_API_KEY", modelsEditable: true, models: ["deepseek-v4-pro", "deepseek-v4-flash"].map((id) => ({ id, contextWindow: 1_000_000, thinking: id.endsWith("pro"), thinkingTransport: "deepseek-thinking" })) },
  { id: "minimax", label: "MiniMax API", description: "MiniMax 官方 API", group: "third-party", protocol: "openai-compatible", envKey: "MINIMAX_API_KEY", modelsEditable: true, baseUrl: [{ id: "china", label: "中国", url: "https://api.minimaxi.com/v1" }, { id: "international", label: "国际", url: "https://api.minimax.io/v1" }], models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed"].map((id) => ({ id, contextWindow: id === "MiniMax-M3" ? 1_000_000 : 204_800 })) },
  { id: "zai", label: "智谱 Z.AI API", description: "智谱标准 API 或 Coding Plan", group: "third-party", protocol: "openai-compatible", envKey: "ZAI_API_KEY", modelsEditable: true, baseUrl: [{ id: "standard", label: "标准 API", url: "https://api.z.ai/api/paas/v4" }, { id: "coding-plan", label: "Coding Plan", url: "https://api.z.ai/api/coding/paas/v4" }], models: ["GLM-5.2", "GLM-5.1", "GLM-5", "GLM-5-Turbo"].map((id) => ({ id, contextWindow: id === "GLM-5.2" ? 1_000_000 : 204_800, thinking: id === "GLM-5.2" || id === "GLM-5.1", thinkingTransport: "glm-thinking" })) },
  { id: "modelscope", label: "魔搭 ModelScope", description: "ModelScope API-Inference", group: "third-party", protocol: "openai-compatible", baseUrl: "https://api-inference.modelscope.cn/v1", envKey: "MODELSCOPE_API_KEY", modelsEditable: true, models: ["deepseek-ai/DeepSeek-V4-Flash", "Qwen/Qwen3.5-397B-A17B", "ZhipuAI/GLM-5.1"].map((id) => ({ id, contextWindow: 1_000_000, thinking: true, thinkingTransport: "enable-thinking" })) },
  { id: "custom", label: "自定义 Provider", description: "连接本地模型、代理或尚未内置的服务", group: "custom", protocol: "openai-compatible", protocolOptions: ["openai-compatible", "anthropic", "gemini"], modelsEditable: true, showAdvancedConfig: true },
]

export function providerDefinition(id: string) { return providerRegistry.find((item) => item.id === id) }

export function providerCatalogPublic() { return providerRegistry.map((item) => ({ ...item })) }

export function generateCustomEnvKey(protocol: ProviderProtocol, baseUrl: string) {
  const canonical = baseUrl.trim().replace(/\/+$/, "")
  const readable = `${protocol}_${canonical}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  const suffix = createHash("sha256").update(`${protocol}\0${canonical}`).digest("hex").slice(0, 12).toUpperCase()
  return `DO_CODE_CUSTOM_API_KEY_${readable}_${suffix}`
}

export const allReasoningEfforts = [...efforts]
