import { Box, Text } from "ink"
import React from "react"
import type { ReactNode } from "react"
import { UserInputSurface } from "./message-layout.js"

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
    <Box flexDirection="column" flexGrow={0} flexShrink={0} marginTop={2}>
      {suggestions ? <Box flexDirection="column" paddingLeft={3} paddingRight={1}>{suggestions}</Box> : null}
      {attachments ? <Box flexDirection="column" paddingLeft={3} paddingRight={1}>{attachments}</Box> : null}
      {activity ? <Box>{activity}</Box> : null}
      <Box aria-role="textbox" aria-state={{ multiline: true, busy: running }}>
        <UserInputSurface width="100%" ariaLabel="Input:" active>
          <Box flexDirection="column" minHeight={1}>{input}</Box>
        </UserInputSurface>
      </Box>
      <Box justifyContent="space-between" width="100%">
        <Text dimColor>{status}</Text>
        {statusRight ? <Text>{statusRight}</Text> : null}
      </Box>
    </Box>
  )
}
