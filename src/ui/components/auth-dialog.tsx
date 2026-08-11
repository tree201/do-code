import React, { useEffect, useState } from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage, ProviderProtocol, RuntimeModelConfig } from "../../config.js"
import { customProviderId, type ProviderInstallInput } from "../../provider-setup.js"
import { discoverProviderModels } from "../../provider-model-discovery.js"
import { providerRegistry, type ProviderDefinition } from "../../provider-registry.js"
import { t } from "../i18n.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"
import { tuiTheme } from "../theme.js"
import type { ChatInputKey } from "../input-routing-types.js"

type AuthStep = "provider" | "protocol" | "base-url" | "region" | "api-key" | "models"

const protocols: Array<{ label: string; value: ProviderProtocol }> = [
  { label: "OpenAI-compatible", value: "openai-compatible" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Gemini", value: "gemini" },
]

const groupLabels: Record<ProviderDefinition["group"], string> = {
  ark: "Volcengine Ark",
  alibaba: "Alibaba ModelStudio",
  "third-party": "Third-party Providers",
  custom: "Custom",
}

const providerTranslations: Record<string, { label: string; description: string }> = {
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

const regionTranslations: Record<string, string> = {
  "中国（北京）": "China (Beijing)",
  "新加坡（国际）": "Singapore (International)",
  新加坡: "Singapore",
  "美国（弗吉尼亚）": "United States (Virginia)",
  "中国（香港）": "China (Hong Kong)",
  中国: "China",
  国际: "International",
  "标准 API": "Standard API",
}

function appendInput(value: string, input: string) {
  return value + input.replace(/[\x00-\x1f\x7f]/g, "")
}

function removeLast(value: string) {
  return Array.from(value).slice(0, -1).join("")
}

function InputLine({ value, secret = false, placeholder }: { value: string; secret?: boolean; placeholder: string }) {
  const shown = secret ? "•".repeat(Array.from(value).length) : value
  return <Text><Text color={tuiTheme.accent}>› </Text>{shown || <Text dimColor>{placeholder}</Text>}<Text inverse> </Text></Text>
}

export function AuthDialog({ currentModel, language, onSubmit, onClose, discoverModels = discoverProviderModels, registerInputHandler }: {
  currentModel: string
  language: DoCodeLanguage
  onSubmit: (input: ProviderInstallInput) => Promise<RuntimeModelConfig>
  onClose: () => void
  discoverModels?: typeof discoverProviderModels
  registerInputHandler?: (handler: ((input: string, key: ChatInputKey) => void) | undefined) => void
}) {
  const currentProvider = currentModel.includes("/") ? currentModel.split("/", 1)[0] : ""
  const matchedProviderIndex = providerRegistry.findIndex((provider) => provider.id === currentProvider)
  const initialProviderIndex = matchedProviderIndex >= 0 ? matchedProviderIndex : providerRegistry.findIndex((provider) => provider.id === "custom")
  const [step, setStep] = useState<AuthStep>("provider")
  const [providerIndex, setProviderIndex] = useState(initialProviderIndex)
  const [provider, setProvider] = useState<ProviderDefinition | null>(null)
  const [protocolIndex, setProtocolIndex] = useState(0)
  const [baseUrl, setBaseUrl] = useState("")
  const [regionIndex, setRegionIndex] = useState(0)
  const [apiKey, setApiKey] = useState("")
  const [modelIndex, setModelIndex] = useState(0)
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [customModels, setCustomModels] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [discovering, setDiscovering] = useState(false)

  const selectableModels = provider?.models?.map((model) => model.id) ?? discoveredModels

  const goBack = () => {
    setError("")
    if (step === "provider") return onClose()
    if (step === "protocol") return setStep("provider")
    if (step === "base-url") return setStep("protocol")
    if (step === "region") return setStep("provider")
    if (step === "api-key") {
      if (provider?.id === "custom") setStep("base-url")
      else if (Array.isArray(provider?.baseUrl)) setStep("region")
      else setStep("provider")
      return
    }
    if (step === "models") setDiscoveredModels([])
    setStep("api-key")
  }

  const selectProvider = () => {
    const selected = providerRegistry[providerIndex]
    if (!selected) return
    setProvider(selected)
    setSelectedModels(selected.models?.map((model) => model.id) ?? [])
    setDiscoveredModels([])
    setCustomModels("")
    setApiKey("")
    setError("")
    if (selected.id === "custom") setStep("protocol")
    else if (Array.isArray(selected.baseUrl)) setStep("region")
    else setStep("api-key")
  }

  const submitInstall = async (manualModelIds?: string[]) => {
    if (!provider) return
    const modelIds = selectableModels.length
      ? selectedModels
      : manualModelIds ?? customModels.split(",").map((model) => model.trim()).filter(Boolean)
    if (!modelIds.length) {
      setError(t(language, "Select at least one model."))
      return
    }
    setSubmitting(true)
    setError("")
    try {
      await onSubmit({
        providerId: provider.id,
        apiKey,
        modelIds,
        ...(provider.id === "custom" ? {
          customProviderId: customProviderId(baseUrl),
          protocol: protocols[protocolIndex]!.value,
          baseUrl,
        } : {}),
        ...(Array.isArray(provider.baseUrl) ? { regionId: provider.baseUrl[regionIndex]!.id } : {}),
      })
      setSubmitting(false)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setSubmitting(false)
    }
  }

  const continueFromApiKey = async (nextApiKey: string) => {
    if (!provider || provider.id !== "custom" || protocols[protocolIndex]?.value !== "openai-compatible") {
      setStep("models")
      return
    }
    setDiscovering(true)
    setError("")
    try {
      const models = await discoverModels(baseUrl, nextApiKey)
      setDiscoveredModels(models)
      setSelectedModels(models)
      setModelIndex(0)
    } catch (caught) {
      setDiscoveredModels([])
      setSelectedModels([])
      setError(`${caught instanceof Error ? caught.message : String(caught)} ${t(language, "Enter model IDs manually.")}`)
    } finally {
      setDiscovering(false)
      setStep("models")
    }
  }

  useEffect(() => {
    const handleInput = (input: string, key: ChatInputKey) => {
    if (submitting || discovering) return
    const submittedText = input.replace(/(?:\r\n|\r|\n)+$/, "")
    const hasReturn = key.return || submittedText !== input
    if (key.escape || key.ctrl && input.toLowerCase() === "c") return goBack()
    if (step === "provider") {
      if (key.upArrow) setProviderIndex((index) => index <= 0 ? providerRegistry.length - 1 : index - 1)
      else if (key.downArrow) setProviderIndex((index) => index >= providerRegistry.length - 1 ? 0 : index + 1)
      else if (hasReturn) selectProvider()
      return
    }
    if (step === "protocol") {
      if (key.upArrow) setProtocolIndex((index) => index <= 0 ? protocols.length - 1 : index - 1)
      else if (key.downArrow) setProtocolIndex((index) => index >= protocols.length - 1 ? 0 : index + 1)
      else if (hasReturn) setStep("base-url")
      return
    }
    if (step === "region") {
      const regions = Array.isArray(provider?.baseUrl) ? provider.baseUrl : []
      if (key.upArrow) setRegionIndex((index) => index <= 0 ? regions.length - 1 : index - 1)
      else if (key.downArrow) setRegionIndex((index) => index >= regions.length - 1 ? 0 : index + 1)
      else if (hasReturn) setStep("api-key")
      return
    }
    if (step === "models" && selectableModels.length) {
      if (key.upArrow) setModelIndex((index) => index <= 0 ? selectableModels.length - 1 : index - 1)
      else if (key.downArrow) setModelIndex((index) => index >= selectableModels.length - 1 ? 0 : index + 1)
      else if (input === " ") {
        const id = selectableModels[modelIndex]!
        setSelectedModels((models) => models.includes(id) ? models.filter((model) => model !== id) : [...models, id])
        setError("")
      } else if (hasReturn) void submitInstall()
      return
    }

    const current = step === "base-url" ? baseUrl : step === "api-key" ? apiKey : customModels
    const update = step === "base-url" ? setBaseUrl : step === "api-key" ? setApiKey : setCustomModels
    if (key.backspace || key.delete) {
      update(removeLast(current))
      setError("")
      return
    }
    const nextValue = submittedText ? appendInput(current, submittedText) : current
    if (hasReturn) {
      const trimmed = nextValue.trim()
      if (!trimmed) {
        setError(t(language, "This field cannot be empty."))
        return
      }
      update(nextValue)
      setError("")
      if (step === "base-url") setStep("api-key")
      else if (step === "api-key") void continueFromApiKey(nextValue)
      else void submitInstall(nextValue.split(",").map((model) => model.trim()).filter(Boolean))
      return
    }
    if (!key.ctrl && !key.meta && input) {
      update(appendInput(current, input))
      setError("")
    }
    }
    registerInputHandler?.(handleInput)
    return () => registerInputHandler?.(undefined)
  }, [apiKey, baseUrl, customModels, discoverModels, discovering, goBack, modelIndex, onClose, provider, protocolIndex, registerInputHandler, selectableModels.length, step, submitting, submitInstall, language])

  const stepTitle = step === "provider" ? t(language, "Connect a Provider")
    : step === "protocol" ? t(language, "Protocol")
        : step === "base-url" ? t(language, "Base URL")
          : step === "region" ? t(language, "Endpoint")
            : step === "api-key" ? t(language, "API Key")
              : t(language, "Models")

  const modelWindowStart = selectableModels.length ? Math.max(0, Math.min(modelIndex - 7, selectableModels.length - 8)) : 0
  const providerText = provider ? providerTranslations[provider.id] : undefined
  return <DialogManager><DialogSurface>
    <Text bold>{provider && step !== "provider" ? `${t(language, providerText?.label ?? provider.label)} · ` : ""}{stepTitle}</Text>
    {step === "provider" ? <Box marginTop={1} flexDirection="column">
      {providerRegistry.map((item, index) => {
        const text = providerTranslations[item.id]
        return <React.Fragment key={item.id}>
          {index === 0 || providerRegistry[index - 1]?.group !== item.group ? <Text bold dimColor>{t(language, groupLabels[item.group])}</Text> : null}
          <Text inverse={providerIndex === index} color={providerIndex === index ? tuiTheme.accent : tuiTheme.border}>
            {providerIndex === index ? "›" : " "} {t(language, text?.label ?? item.label)}  <Text dimColor={providerIndex !== index}>{t(language, text?.description ?? item.description)}</Text>
          </Text>
        </React.Fragment>
      })}
    </Box> : null}
    {step === "protocol" ? <Box marginTop={1} flexDirection="column">{protocols.map((item, index) => <Text key={item.value} inverse={protocolIndex === index} color={protocolIndex === index ? tuiTheme.accent : tuiTheme.border}>{protocolIndex === index ? "›" : " "} {t(language, item.label)}</Text>)}</Box> : null}
    {step === "base-url" ? <Box marginTop={1}><InputLine value={baseUrl} placeholder="https://api.example.com/v1" /></Box> : null}
    {step === "region" && Array.isArray(provider?.baseUrl) ? <Box marginTop={1} flexDirection="column">{provider.baseUrl.map((region, index) => <Text key={region.id} inverse={regionIndex === index} color={regionIndex === index ? tuiTheme.accent : tuiTheme.border}>{regionIndex === index ? "›" : " "} {t(language, regionTranslations[region.label] ?? region.label)}  <Text dimColor={regionIndex !== index}>{region.url}</Text></Text>)}</Box> : null}
    {step === "api-key" ? <Box marginTop={1}><InputLine value={apiKey} secret placeholder={provider?.apiKeyPlaceholder ?? "sk-..."} /></Box> : null}
    {step === "models" && selectableModels.length ? <Box marginTop={1} flexDirection="column">
      <Text dimColor>{t(language, "Space toggles a model; Enter installs the selection.")}</Text>
      {selectableModels.slice(modelWindowStart, modelWindowStart + 8).map((model, offset) => {
        const index = modelWindowStart + offset
        const selected = selectedModels.includes(model)
        return <Text key={model} inverse={modelIndex === index} color={modelIndex === index ? tuiTheme.accent : selected ? tuiTheme.success : tuiTheme.border}>{modelIndex === index ? "›" : " "} {selected ? "●" : "○"} {model}</Text>
      })}
      {selectableModels.length > 8 ? <Text dimColor>{modelWindowStart + 1}-{Math.min(selectableModels.length, modelWindowStart + 8)} / {selectableModels.length}</Text> : null}
    </Box> : null}
    {step === "models" && provider && !selectableModels.length ? <Box marginTop={1} flexDirection="column"><Text dimColor>{t(language, "Separate multiple model IDs with commas.")}</Text><InputLine value={customModels} placeholder="model-id" /></Box> : null}
    {error ? <Box marginTop={1}><Text color={tuiTheme.danger}>{error}</Text></Box> : null}
    <Box marginTop={1}><Text dimColor>{discovering ? t(language, "Discovering available models...") : submitting ? t(language, "Saving and switching model...") : step === "provider" || step === "protocol" || step === "region" || step === "models" && selectableModels.length > 0 ? t(language, "↑↓ Select · Enter Confirm · Esc Back") : t(language, "Type a value · Enter Continue · Esc Back")}</Text></Box>
  </DialogSurface></DialogManager>
}
