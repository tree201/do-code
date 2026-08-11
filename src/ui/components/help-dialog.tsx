import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import { t } from "../i18n.js"
import { helpText } from "../slash-command-help.js"
import { padTerminalEnd, wrapTerminalLines } from "../terminal-text.js"
import { tuiTheme } from "../theme.js"
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
      <Text bold color={tuiTheme.accent}>{t(language, "Keyboard shortcuts and help")}<Text dimColor>  {lines.length ? `${start + 1}-${Math.min(lines.length, start + rows)}/${lines.length}` : "0/0"}</Text></Text>
      <Box flexDirection="column" marginTop={1} height={rows} overflow="hidden">
        {visible.map((line, index) => <Text key={`${start + index}-${line}`} wrap="truncate-end">{line || " "}</Text>)}
      </Box>
      <Text dimColor wrap="truncate-end">{t(language, "↑↓ · PgUp/PgDn · Home/End · Ctrl+H/Esc Close")}</Text>
    </DialogSurface></DialogManager>
  )
}

function columnHeight(groups: string[][]) {
  return groups.reduce((total, group) => total + group.length, Math.max(0, groups.length - 1))
}

function joinColumn(groups: string[][]) {
  return groups.flatMap((group, index) => index ? ["", ...group] : group)
}
