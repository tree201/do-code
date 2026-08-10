import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import { buildActivitySummary, type ActivitySummaryLine } from "../activity-summary.js"
import { activitySucceeded, type TranscriptTool } from "../transcript-model.js"
import { tuiTheme } from "../theme.js"
import { ActivityDiff, ActivityDiffStats } from "./activity-diff.js"
import { MessageRow, STATUS_DOT } from "./message-layout.js"

function ActivityDetailLine({ line }: { line: ActivitySummaryLine }) {
  const color = line.tone === "accent"
    ? tuiTheme.accent
    : line.tone === "success"
      ? tuiTheme.success
      : line.tone === "danger"
        ? tuiTheme.danger
        : undefined
  return <Text {...(color ? { color } : {})} dimColor={line.tone === "muted"} wrap="wrap">{line.text}</Text>
}

export type ToolActivityGroupProps = {
  tools: TranscriptTool[]
  phase: "pending" | "completed"
  width: number
  language: DoCodeLanguage
}

export const ToolActivityGroup = React.memo(function ToolActivityGroup({ tools, phase, width, language }: ToolActivityGroupProps) {
  const summary = useMemo(() => buildActivitySummary(tools, language), [language, tools])
  const ok = activitySucceeded(tools)
  const singleSuccessfulDiff = ok && summary.diffs?.length === 1 ? summary.diffs[0] : undefined
  const contentWidth = Math.max(1, width)
  return (
    <Box flexDirection="column" width={contentWidth}>
      <MessageRow prefix={STATUS_DOT} color={ok ? tuiTheme.success : tuiTheme.danger} ariaLabel={ok ? "Tools succeeded:" : "Tool failed:"} marginBottom={0}>
        {phase === "completed" && singleSuccessfulDiff ? (
          <Text bold wrap="truncate-end">{language === "zh" ? "修改 " : "Edited "}{singleSuccessfulDiff.path}<ActivityDiffStats file={singleSuccessfulDiff} /></Text>
        ) : <Text bold wrap="truncate-end">{summary.title}</Text>}
        {phase === "completed" ? summary.lines.map((line, index) => (
          <Box key={`${index}-${line.text}`} paddingLeft={2}>
            <Text dimColor>{index === 0 ? "└ " : "  "}</Text>
            <Box flexGrow={1}><ActivityDetailLine line={line} /></Box>
          </Box>
        )) : null}
      </MessageRow>
      {phase === "completed" ? summary.diffs?.map((file, index) => <ActivityDiff key={`${index}-${file.path}`} file={file} width={Math.max(12, width)} language={language} showHeader={!singleSuccessfulDiff} />) : null}
    </Box>
  )
})
