import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import { t } from "../i18n.js"
import { helpText } from "../slash-command-help.js"
import { wrapTerminalLines } from "../terminal-text.js"
import { tuiTheme } from "../theme.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"

export function shortcutHelpText(language: DoCodeLanguage) {
  return helpText(language)
}

export function HelpDialog({ language, width, height, offset }: { language: DoCodeLanguage; width: number; height: number; offset: number }) {
  const contentWidth = Math.max(20, width - 4)
  const lines = wrapTerminalLines(shortcutHelpText(language), contentWidth)
  const rows = Math.max(5, Math.min(20, height - 8))
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
