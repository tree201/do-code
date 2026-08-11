import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import type { ToolApprovalRequest } from "../../policy.js"
import { approvalEditDiff, approvalLabels } from "../approval-model.js"
import { t } from "../i18n.js"
import { ActivityDiff } from "./activity-diff.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"
import { tuiTheme } from "../theme.js"

const EDIT_FILE_TOOL = "edit_file"

export function ApprovalDialog({ request, selectedIndex, language, width }: {
  request: ToolApprovalRequest
  selectedIndex: number
  language: DoCodeLanguage
  width: number
}) {
  const labels = approvalLabels(request, language)
  const diff = approvalEditDiff(request)
  const choices = ["Allow once", "Allow for this session", "Always allow this action", "Deny"].map((choice) => t(language, choice))
  const detail = request.tool === EDIT_FILE_TOOL ? "" : request.detail
  return (
    <DialogManager><DialogSurface color={request.dangerous ? tuiTheme.danger : tuiTheme.border}>
      <Text>
        <Text color={request.dangerous ? tuiTheme.danger : tuiTheme.accent}>• </Text>
        <Text bold>{labels.title}</Text>
        <Text dimColor>  {labels.risk}</Text>
      </Text>
      {diff ? <ActivityDiff file={diff} width={Math.max(12, width - 4)} language={language} showHeader={false} /> : null}
      {detail ? <Box marginTop={1}><Text dimColor wrap="wrap">{detail}</Text></Box> : null}
      <Box marginTop={1}><Text>{labels.question}</Text></Box>
      <Box marginTop={1} flexDirection="column">
        {choices.map((choice, index) => {
          const selected = selectedIndex === index
          const color = index === 3 ? tuiTheme.danger : selected ? tuiTheme.accent : tuiTheme.border
          return <Text key={choice} bold={selected} color={color}>{selected ? "›" : " "} {index + 1}. {choice}</Text>
        })}
      </Box>
      <Box marginTop={1}><Text dimColor>{t(language, "↑↓ Select · Enter Confirm · Esc Deny")}</Text></Box>
    </DialogSurface></DialogManager>
  )
}
