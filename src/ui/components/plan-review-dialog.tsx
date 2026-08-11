import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import type { PlanProposal } from "../../tools.js"
import { t } from "../i18n.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"
import { tuiTheme } from "../theme.js"

export function PlanReviewDialog({ plan, selectedIndex, language, width = 80 }: { plan: PlanProposal; selectedIndex: number; language: DoCodeLanguage; width?: number }) {
  const choices = [t(language, "Execute"), t(language, "Revise"), t(language, "Cancel")]
  return (
    <DialogManager><DialogSurface>
      <Text bold>• {t(language, "Proposed Plan")}</Text>
      <Box marginTop={1} flexDirection="column">
        {choices.map((choice, index) => <Text key={choice} inverse={selectedIndex === index} color={index === 2 ? tuiTheme.danger : selectedIndex === index ? tuiTheme.accent : tuiTheme.border}>{selectedIndex === index ? "›" : " "} {index + 1}. {choice}</Text>)}
      </Box>
      <Box marginTop={1}><Text dimColor>{t(language, "↑↓ Select · Enter Confirm · Esc Cancel")}</Text></Box>
    </DialogSurface></DialogManager>
  )
}
