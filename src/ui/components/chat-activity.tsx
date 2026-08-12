import React, { useEffect, useState } from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import { activeToolSummary } from "../tool-summary.js"
import { formatElapsedTime, preview } from "../chat-presentation.js"
import { MESSAGE_PREFIX_WIDTH, MessageContinuation, MessageRow, STATUS_DOT } from "./message-layout.js"
import { THINKING_BREATH_INTERVAL_MS, thinkingBreathColors, tuiTheme } from "../theme.js"
import { t } from "../i18n.js"
import { MarkdownText } from "../markdown.js"
import { expandComposerValue, type ComposerDraft } from "../attachment-model.js"

export function Spinner({ label, language }: { label: string; language: DoCodeLanguage }) {
  const [phase, setPhase] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => { const timer = setInterval(() => setPhase((value) => (value + 1) % thinkingBreathColors.length), THINKING_BREATH_INTERVAL_MS); return () => clearInterval(timer) }, [])
  useEffect(() => { const started = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000); return () => clearInterval(timer) }, [])
  const color = thinkingBreathColors[phase]!
  return <MessageRow prefix={STATUS_DOT} color={color} marginTop={0} marginBottom={0}><Text color={color}>{label} · {formatElapsedTime(elapsed)}{t(language, " · Esc stop")}</Text></MessageRow>
}

export function RunningActivity({ liveAssistant, width, height, activityEpoch, activeTool, reasoningCharacters, language }: {
  liveAssistant: string
  width: number
  height: number
  activityEpoch: number
  activeTool: string | { name: string; args: unknown } | null
  reasoningCharacters: number
  language: DoCodeLanguage
}) {
  return <Box flexDirection="column">
    {liveAssistant ? <MessageContinuation><MarkdownText width={Math.max(1, width - MESSAGE_PREFIX_WIDTH)} pending trimBoundarySpacing maxPendingCodeRows={Math.max(3, Math.min(12, height - 12))}>{liveAssistant}</MarkdownText></MessageContinuation> : null}
  </Box>
}

export function RunningStatus({ activityEpoch, activeTool, reasoningCharacters, language }: {
  activityEpoch: number
  activeTool: string | { name: string; args: unknown } | null
  reasoningCharacters: number
  language: DoCodeLanguage
}) {
  const label = activeTool
    ? typeof activeTool === "string" ? activeTool : activeToolSummary(activeTool.name, activeTool.args, language)
    : reasoningCharacters > 0
      ? t(language, "Thinking · {count} reasoning characters received", { count: reasoningCharacters.toLocaleString() })
      : t(language, "Thinking")
  return <Spinner key={`activity-${activityEpoch}`} label={label} language={language} />
}

export function QueuedMessages({ messages, language }: { messages: ComposerDraft[]; language: DoCodeLanguage }) {
  if (!messages.length) return null
  return <Box flexDirection="column"><Text dimColor>{t(language, "{count} queued (↑ to edit the latest)", { count: messages.length })}</Text>{messages.slice(0, 3).map((message, index) => { const display = expandComposerValue(message.value, message.nodes, "display"); return <Text key={`${index}-${display}`} dimColor>{index + 1}. {preview(display.replace(/\s+/g, " "), 100)}</Text> })}{messages.length > 3 ? <Text dimColor>{t(language, "…and {count} more", { count: messages.length - 3 })}</Text> : null}</Box>
}
