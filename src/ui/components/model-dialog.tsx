import React, { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { DoCodeLanguage, RuntimeModelConfig } from "../../config.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"
import { tuiTheme } from "../theme.js"

export function ModelDialog({ models, currentModel, language, onSelect, onClose }: {
  models: string[]
  currentModel: string
  language: DoCodeLanguage
  onSelect: (model: string) => Promise<RuntimeModelConfig>
  onClose: () => void
}) {
  const zh = language === "zh"
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return models.filter((model) => !normalized || model.toLowerCase().includes(normalized))
  }, [models, query])
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, models.indexOf(currentModel)))
  const [error, setError] = useState("")
  const [switching, setSwitching] = useState(false)
  const effectiveIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1))
  const windowStart = Math.max(0, Math.min(effectiveIndex - 5, filtered.length - 10))

  useInput((input, key) => {
    if (switching) return
    if (key.escape || key.ctrl && input.toLowerCase() === "c") return onClose()
    if (key.upArrow) {
      setSelectedIndex((index) => filtered.length ? (Math.min(index, filtered.length - 1) - 1 + filtered.length) % filtered.length : 0)
      return
    }
    if (key.downArrow) {
      setSelectedIndex((index) => filtered.length ? (Math.min(index, filtered.length - 1) + 1) % filtered.length : 0)
      return
    }
    if (key.return || /(?:\r\n|\r|\n)$/.test(input)) {
      const selected = filtered[effectiveIndex]
      if (!selected) return
      setSwitching(true)
      setError("")
      void onSelect(selected).then(onClose).catch((caught) => {
        setError(caught instanceof Error ? caught.message : String(caught))
        setSwitching(false)
      })
      return
    }
    if (key.backspace || key.delete) {
      setQuery((value) => Array.from(value).slice(0, -1).join(""))
      setSelectedIndex(0)
      setError("")
      return
    }
    if (!key.ctrl && !key.meta && input) {
      setQuery((value) => value + input.replace(/[\x00-\x1f\x7f]/g, ""))
      setSelectedIndex(0)
      setError("")
    }
  }, { isActive: true })

  return <DialogManager><DialogSurface>
    <Text bold>{zh ? "选择模型" : "Select Model"}</Text>
    <Box marginTop={1}><Text><Text color={tuiTheme.accent}>› </Text>{query || <Text dimColor>{zh ? "输入文字筛选模型" : "Type to filter models"}</Text>}<Text inverse> </Text></Text></Box>
    <Box marginTop={1} flexDirection="column">
      {filtered.length ? filtered.slice(windowStart, windowStart + 10).map((model, offset) => {
        const index = windowStart + offset
        const selected = index === effectiveIndex
        const current = model === currentModel
        return <Text key={model} inverse={selected} color={selected ? tuiTheme.accent : current ? tuiTheme.success : tuiTheme.border}>
          {selected ? "›" : " "} {current ? "●" : "○"} {model}{current ? (zh ? "（当前）" : " (current)") : ""}
        </Text>
      }) : <Text dimColor>{zh ? "没有匹配的模型" : "No matching models"}</Text>}
      {filtered.length > 10 ? <Text dimColor>{windowStart + 1}-{Math.min(filtered.length, windowStart + 10)} / {filtered.length}</Text> : null}
    </Box>
    {error ? <Box marginTop={1}><Text color={tuiTheme.danger}>{error}</Text></Box> : null}
    <Box marginTop={1}><Text dimColor>{switching ? (zh ? "正在切换模型..." : "Switching model...") : (zh ? "输入筛选 · ↑↓ 选择 · Enter 切换 · Esc 关闭" : "Type to filter · ↑↓ Select · Enter Switch · Esc Close")}</Text></Box>
  </DialogSurface></DialogManager>
}
