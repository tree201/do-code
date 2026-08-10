import { Box, Text } from "ink"
import React from "react"
import type { ReactNode } from "react"
import { tuiTheme } from "../theme.js"

export type ComposerProps = {
  running: boolean
  input: ReactNode
  activity?: ReactNode
  suggestions?: ReactNode
  attachments?: ReactNode
  status: ReactNode
  statusRight?: ReactNode
}

/** Stable input surface kept outside the scrollable transcript. */
export function Composer({ running, input, activity, suggestions, attachments, status, statusRight }: ComposerProps) {
  return (
    <Box flexDirection="column" flexGrow={0} flexShrink={0} marginTop={1}>
      {suggestions ? <Box flexDirection="column" paddingLeft={3} paddingRight={1}>{suggestions}</Box> : null}
      {attachments ? <Box flexDirection="column" paddingLeft={3} paddingRight={1}>{attachments}</Box> : null}
      {activity ? <Box>{activity}</Box> : null}
      <Box
        borderStyle="round"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderColor={running ? tuiTheme.accent : tuiTheme.border}
        height={0}
      />
      <Box
        flexDirection="column"
        paddingX={1}
        aria-role="textbox"
        aria-state={{ multiline: true, busy: running }}
      >
        <Box flexDirection="column" minHeight={2}>{input}</Box>
        <Box paddingLeft={2} justifyContent="space-between" width="100%">
          <Text dimColor>{status}</Text>
          {statusRight ? <Text>{statusRight}</Text> : null}
        </Box>
      </Box>
      <Box
        borderStyle="round"
        borderTop={false}
        borderBottom
        borderLeft={false}
        borderRight={false}
        borderColor={running ? tuiTheme.accent : tuiTheme.border}
        height={0}
      />
    </Box>
  )
}
