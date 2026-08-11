import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import type { ApprovalMode } from "../../policy.js"
import { t } from "../i18n.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"
import { tuiTheme } from "../theme.js"

export function PermissionModeDialog({ currentMode, selectedIndex, language }: { currentMode: ApprovalMode; selectedIndex: number; language: DoCodeLanguage }) {
  const modes: ApprovalMode[] = ["ask", "auto", "full-access"]
  const labels = ["Ask for approval", "Approve for me", "Full Access"].map((label) => t(language, label))
  const descriptions = [
    "Read and edit the current workspace and run ordinary commands; ask before network or outside-workspace access.",
    "Automatically run ordinary edits, commands, and network access; ask only for potentially unsafe actions.",
    "Edit files outside the workspace and access the network without ordinary approval prompts. Use with caution.",
  ].map((description) => t(language, description))
  return (
    <DialogManager><DialogSurface>
      <Text bold>{t(language, "Update Model Permissions")}</Text>
      <Box marginTop={1} flexDirection="column">
        {modes.map((mode, index) => {
          const selected = selectedIndex === index
          const current = currentMode === mode
          return <Text key={mode} inverse={selected} color={selected ? tuiTheme.accent : tuiTheme.border}>
            {selected ? "›" : " "} {index + 1}. {labels[index]}{current ? `${language === "zh" ? "" : " "}${t(language, "(current)")}` : ""}  <Text dimColor={!selected}>{descriptions[index]}</Text>
          </Text>
        })}
      </Box>
      <Box marginTop={1}><Text dimColor>{t(language, "↑↓ Select · Enter Confirm · Esc Cancel")}</Text></Box>
    </DialogSurface></DialogManager>
  )
}
