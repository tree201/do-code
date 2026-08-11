import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import { t } from "../i18n.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"
import { EFFORT_COMMAND, EXPORT_COMMAND, HELP_COMMAND, MODEL_COMMAND, PERMISSIONS_COMMAND, PLAN_COMMAND, RESUME_COMMAND, THINKING_COMMAND } from "../shortcut-command-policy.js"
import { wrapTerminalLines } from "../terminal-text.js"
import { tuiTheme } from "../theme.js"

export function shortcutHelpText(language: DoCodeLanguage) {
  return [
    t(language, "Input and editing"),
    t(language, "Enter              Send message"),
    t(language, "Ctrl+Enter           Insert newline"),
    t(language, "Ctrl+J / Alt+Enter   Compatible newline"),
    t(language, "Ctrl+A / Ctrl+E     Move to line start / end"),
    t(language, "Ctrl+U              Clear input"),
    t(language, "Ctrl+Z / Ctrl+Y     Undo / redo"),
    t(language, "Backspace           Delete the previous character"),
    "",
    t(language, "Model and modes"),
    t(language, "Ctrl+R              Cycle reasoning effort"),
    t(language, "Shift+Tab           Toggle Plan mode"),
    t(language, "Ctrl+T              View all messages"),
    t(language, "Ctrl+V              Paste clipboard image"),
    "",
    t(language, "Commands and sessions"),
    `${HELP_COMMAND}               ${t(language, "Show command help")}`,
    `${MODEL_COMMAND}              ${t(language, "Show or switch models")}`,
    `${EFFORT_COMMAND}             ${t(language, "Set reasoning effort")}`,
    `${THINKING_COMMAND}           ${t(language, "Switch thinking mode")}`,
    `${PLAN_COMMAND}               ${t(language, "Enter or leave Plan mode")}`,
    `${PERMISSIONS_COMMAND}        ${t(language, "Set model permissions")}`,
    `${RESUME_COMMAND}             ${t(language, "Resume a previous session")}`,
    `${EXPORT_COMMAND}             ${t(language, "Export the current session")}`,
    t(language, "@path               Attach a workspace file"),
    t(language, "!command            Run a Shell command directly"),
    "",
    t(language, "Help dialog"),
    t(language, "Ctrl+H              Close help"),
    t(language, "Esc                 Close help"),
    t(language, "↑↓                  Scroll"),
    t(language, "PgUp / PgDn         Page up / down"),
    t(language, "Home / End          Jump to the beginning / end"),
  ].join("\n")
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
