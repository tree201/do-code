import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import type { PlanProposal } from "../../tools.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"
import { tuiTheme } from "../theme.js"

export function PlanReviewDialog({ plan, selectedIndex, language, width = 80 }: { plan: PlanProposal; selectedIndex: number; language: DoCodeLanguage; width?: number }) {
  const zh = language === "zh"
  const choices = zh ? ["执行", "修改", "取消"] : ["Execute", "Revise", "Cancel"]
  return (
    <DialogManager><DialogSurface>
      <Text bold>• {zh ? "建议计划" : "Proposed Plan"}</Text>
      <Box marginTop={1} flexDirection="column">
        {choices.map((choice, index) => <Text key={choice} inverse={selectedIndex === index} color={index === 2 ? tuiTheme.danger : selectedIndex === index ? tuiTheme.accent : tuiTheme.border}>{selectedIndex === index ? "›" : " "} {index + 1}. {choice}</Text>)}
      </Box>
      <Box marginTop={1}><Text dimColor>{zh ? "↑↓ 选择 · Enter 确认 · Esc 取消" : "↑↓ Select · Enter Confirm · Esc Cancel"}</Text></Box>
    </DialogSurface></DialogManager>
  )
}
