import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Box, Text, useStdout } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import { t } from "../i18n.js"
import { helpText } from "../slash-command-help.js"
import { padTerminalEnd, wrapTerminalLines } from "../terminal-text.js"
import { tuiTheme } from "../theme.js"
import type { ViewportInputBridge, ViewportInputKey } from "../viewport-surface.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"

const COLUMN_GAP = 4
const MIN_COLUMN_WIDTH = 56

export function shortcutHelpText(language: DoCodeLanguage) {
  return helpText(language)
}

export function helpDialogLines(language: DoCodeLanguage, width: number) {
  const contentWidth = Math.max(20, width - 4)
  const groups = shortcutHelpText(language).split("\n\n")
  const columnWidth = Math.floor((contentWidth - COLUMN_GAP) / 2)
  if (groups.length < 2 || columnWidth < MIN_COLUMN_WIDTH) return wrapTerminalLines(groups.join("\n\n"), contentWidth)

  const wrappedGroups = groups.map((group) => wrapTerminalLines(group, columnWidth))
  let split = 1
  let bestDifference = Number.POSITIVE_INFINITY
  for (let index = 1; index < wrappedGroups.length; index++) {
    const leftHeight = columnHeight(wrappedGroups.slice(0, index))
    const rightHeight = columnHeight(wrappedGroups.slice(index))
    const difference = Math.abs(leftHeight - rightHeight)
    if (difference < bestDifference) { split = index; bestDifference = difference }
  }

  const left = joinColumn(wrappedGroups.slice(0, split))
  const right = joinColumn(wrappedGroups.slice(split))
  return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
    const leftLine = left[index] ?? ""
    const rightLine = right[index] ?? ""
    return rightLine ? `${padTerminalEnd(leftLine, columnWidth)}${" ".repeat(COLUMN_GAP)}${rightLine}` : leftLine
  })
}

export function helpDialogRows(height: number) {
  return Math.max(5, height - 8)
}

export function HelpDialog({ language, width, height, offset }: { language: DoCodeLanguage; width: number; height: number; offset: number }) {
  const lines = helpDialogLines(language, width)
  const rows = helpDialogRows(height)
  const maximum = Math.max(0, lines.length - rows)
  const start = Math.min(maximum, Math.max(0, offset))
  const visible = lines.slice(start, start + rows)
  return (
    <DialogManager><DialogSurface>
      <Text bold color={tuiTheme.brand}>{t(language, "Keyboard shortcuts and help")}<Text dimColor>  {lines.length ? `${start + 1}-${Math.min(lines.length, start + rows)}/${lines.length}` : "0/0"}</Text></Text>
      <Box flexDirection="column" marginTop={1} height={rows} overflow="hidden">
        {visible.map((line, index) => <Text key={`${start + index}-${line}`} wrap="truncate-end">{line || " "}</Text>)}
      </Box>
      <Text dimColor wrap="truncate-end">{t(language, "↑↓ · PgUp/PgDn · Home/End · Ctrl+H/Esc Close")}</Text>
    </DialogSurface></DialogManager>
  )
}

export function AlternateHelpDialog({ language, onClose, inputBridge }: { language: DoCodeLanguage; onClose: () => void; inputBridge: ViewportInputBridge }) {
  const { stdout } = useStdout()
  const [width, setWidth] = useState(() => stdout.columns || 80)
  const [height, setHeight] = useState(() => stdout.rows || 24)
  const [offset, setOffset] = useState(0)
  const lines = useMemo(() => helpDialogLines(language, width), [language, width])
  const rows = helpDialogRows(height)
  const maximum = Math.max(0, lines.length - rows)
  const effectiveOffset = Math.min(maximum, Math.max(0, offset))

  useEffect(() => {
    const updateSize = () => { setWidth(stdout.columns || 80); setHeight(stdout.rows || 24) }
    stdout.on("resize", updateSize)
    return () => { stdout.off("resize", updateSize) }
  }, [stdout])

  const handleInput = useCallback((input: string, key: ViewportInputKey) => {
    const isCtrlH = key.ctrl && (input.toLowerCase() === "h" || input === "\u0008")
    if (isCtrlH || key.escape || input === "q" || (key.ctrl && input.toLowerCase() === "c")) { onClose(); return }
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

  return <HelpDialog language={language} width={width} height={height} offset={effectiveOffset} />
}

function columnHeight(groups: string[][]) {
  return groups.reduce((total, group) => total + group.length, Math.max(0, groups.length - 1))
}

function joinColumn(groups: string[][]) {
  return groups.flatMap((group, index) => index ? ["", ...group] : group)
}
