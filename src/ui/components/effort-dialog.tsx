import React, { useCallback, useEffect, useState } from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage, ReasoningEffort, RuntimeModelConfig } from "../../config.js"
import { t } from "../i18n.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"
import { tuiTheme } from "../theme.js"
import type { ChatInputKey } from "../input-routing-types.js"

export function EffortDialog({ efforts, currentEffort, defaultEffort, language, onSelect, onPersist, onClose, registerInputHandler }: {
  efforts: ReasoningEffort[]
  currentEffort: ReasoningEffort
  defaultEffort?: ReasoningEffort
  language: DoCodeLanguage
  onSelect: (effort: ReasoningEffort) => Promise<RuntimeModelConfig>
  onPersist?: (effort: ReasoningEffort) => Promise<void>
  onClose: () => void
  registerInputHandler?: (handler: ((input: string, key: ChatInputKey) => void) | undefined) => void
}) {
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, efforts.indexOf(currentEffort)))
  const [error, setError] = useState("")
  const [applying, setApplying] = useState(false)
  const [persist, setPersist] = useState(false)
  const effectiveIndex = Math.min(selectedIndex, Math.max(0, efforts.length - 1))

  const handleInput = useCallback((input: string, key: ChatInputKey) => {
    if (applying) return
    if (key.escape || key.ctrl && input.toLowerCase() === "c") return onClose()
    if (key.upArrow) {
      setSelectedIndex((index) => efforts.length ? (Math.min(index, efforts.length - 1) - 1 + efforts.length) % efforts.length : 0)
      return
    }
    if (key.downArrow) {
      setSelectedIndex((index) => efforts.length ? (Math.min(index, efforts.length - 1) + 1) % efforts.length : 0)
      return
    }
    if (key.tab && onPersist) {
      setPersist((value) => !value)
      return
    }
    if (key.return || /(?:\r\n|\r|\n)$/.test(input)) {
      const selected = efforts[effectiveIndex]
      if (!selected) return
      setApplying(true)
      setError("")
      void onSelect(selected).then(async () => {
        if (persist) await onPersist?.(selected)
        onClose()
      }).catch((caught) => {
        setError(caught instanceof Error ? caught.message : String(caught))
        setApplying(false)
      })
    }
  }, [applying, effectiveIndex, efforts, onClose, onPersist, onSelect, persist])

  useEffect(() => {
    registerInputHandler?.(handleInput)
    return () => registerInputHandler?.(undefined)
  }, [handleInput, registerInputHandler])

  return <DialogManager><DialogSurface>
    <Text bold>{t(language, "Select Reasoning Effort")}</Text>
    <Box marginTop={1} flexDirection="column">
      {efforts.map((effort, index) => {
        const selected = index === effectiveIndex
        const current = effort === currentEffort
        const remembered = effort === defaultEffort
        return <Text key={effort} inverse={selected} color={selected ? tuiTheme.accent : current ? tuiTheme.success : tuiTheme.border}>
          {selected ? "›" : " "} {current ? "●" : "○"} {effort}{current ? ` ${t(language, "(current)")}` : ""}{remembered ? ` ${t(language, "(default)")}` : ""}
        </Text>
      })}
    </Box>
    {error ? <Box marginTop={1}><Text color={tuiTheme.danger}>{error}</Text></Box> : null}
    {onPersist ? <Box marginTop={1}><Text color={persist ? tuiTheme.success : tuiTheme.border}>{persist ? "●" : "○"} {t(language, "Remember reasoning effort for future sessions")}</Text></Box> : null}
    <Box marginTop={1}><Text dimColor>{applying ? t(language, "Applying reasoning effort...") : t(language, "↑↓ Select · Tab Remember · Enter Apply · Esc Close")}</Text></Box>
  </DialogSurface></DialogManager>
}
