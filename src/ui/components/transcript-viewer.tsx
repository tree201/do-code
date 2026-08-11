import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Box, Text, useStdout } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import { t } from "../i18n.js"
import type { TranscriptItem } from "../transcript-model.js"
import { cachedTranscriptViewerLines } from "../transcript-viewer-cache.js"
import { tuiTheme } from "../theme.js"

export const TranscriptViewer = React.memo(function TranscriptViewer({ items, offset, width, height, language, preparedLines }: { items: TranscriptItem[]; offset: number; width: number; height: number; language: DoCodeLanguage; preparedLines?: string[] }) {
  const contentWidth = Math.max(8, width - 4)
  const rows = Math.max(3, height - 4)
  const lines = useMemo(
    () => preparedLines ?? cachedTranscriptViewerLines(items, language, contentWidth),
    [contentWidth, items, language, preparedLines],
  )
  const maximum = Math.max(0, lines.length - rows)
  const start = Math.min(maximum, Math.max(0, offset))
  const visible = lines.slice(start, start + rows)
  return <Box
    flexDirection="column"
    borderStyle="round"
    borderColor={tuiTheme.accent}
    paddingX={1}
    width={Math.max(12, width)}
    height={height}
    minHeight={height}
    flexGrow={0}
    flexShrink={0}
    overflow="hidden"
  >
    <Text bold color={tuiTheme.accent}>{t(language, "Message viewer")}<Text dimColor>  {lines.length ? `${start + 1}-${Math.min(lines.length, start + rows)}/${lines.length}` : "0/0"}</Text></Text>
    {visible.map((line, index) => <Text key={`${start + index}-${line}`} wrap="truncate-end">{line || " "}</Text>)}
    {visible.length < rows ? <Box height={rows - visible.length} flexShrink={0} /> : null}
    <Text dimColor wrap="truncate-end">{t(language, "↑↓ · PgUp/PgDn · Home/End · Ctrl+T/Esc Back")}</Text>
  </Box>
})

export type ViewerInputKey = {
  ctrl?: boolean
  escape?: boolean
  upArrow?: boolean
  downArrow?: boolean
  pageUp?: boolean
  pageDown?: boolean
  home?: boolean
  end?: boolean
}

export class ViewerInputBridge {
  private handler: ((input: string, key: ViewerInputKey) => void) | null = null

  attach(handler: ((input: string, key: ViewerInputKey) => void) | null) {
    this.handler = handler
  }

  dispatch(input: string, key: ViewerInputKey) {
    this.handler?.(input, key)
  }
}

export function AlternateTranscriptViewer({ items, language, onClose, inputBridge }: {
  items: TranscriptItem[]
  language: DoCodeLanguage
  onClose: () => void
  inputBridge: ViewerInputBridge
}) {
  const { stdout } = useStdout()
  const [width, setWidth] = useState(() => stdout.columns || 80)
  const [height, setHeight] = useState(() => stdout.rows || 24)
  const [offset, setOffset] = useState(Number.MAX_SAFE_INTEGER)
  const contentWidth = Math.max(8, width - 4)
  const rows = Math.max(3, height - 4)
  const lines = useMemo(
    () => cachedTranscriptViewerLines(items, language, contentWidth),
    [contentWidth, items, language],
  )
  const maximum = Math.max(0, lines.length - rows)
  const effectiveOffset = Math.min(maximum, Math.max(0, offset))

  useEffect(() => {
    const updateSize = () => {
      setWidth(stdout.columns || 80)
      setHeight(stdout.rows || 24)
    }
    stdout.on("resize", updateSize)
    return () => { stdout.off("resize", updateSize) }
  }, [stdout])

  const handleInput = useCallback((input: string, key: ViewerInputKey) => {
    const isCtrlT = key.ctrl && (input.toLowerCase() === "t" || input === "\u0014")
    if (isCtrlT || key.escape || input === "q" || (key.ctrl && input.toLowerCase() === "c")) { onClose(); return }
    if (key.upArrow) { setOffset(Math.max(0, effectiveOffset - 1)); return }
    if (key.downArrow) { setOffset(Math.min(maximum, effectiveOffset + 1)); return }
    if (key.pageUp) { setOffset(Math.max(0, effectiveOffset - rows)); return }
    if (key.pageDown) { setOffset(Math.min(maximum, effectiveOffset + rows)); return }
    if (key.home) { setOffset(0); return }
    if (key.end) setOffset(maximum)
  }, [effectiveOffset, maximum, onClose, rows])

  useEffect(() => {
    inputBridge.attach(handleInput)
    return () => { inputBridge.attach(null) }
  }, [handleInput, inputBridge])

  return <TranscriptViewer items={items} offset={effectiveOffset} width={width} height={Math.max(5, height)} language={language} preparedLines={lines} />
}
