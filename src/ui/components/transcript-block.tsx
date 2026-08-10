import React from "react"
import type { ReactNode } from "react"
import { Box, Text } from "ink"
import type { TranscriptBoundary } from "../transcript-layout.js"
import { tuiTheme } from "../theme.js"

export function TranscriptBlock({ children, first = false, boundary, width }: {
  children?: ReactNode
  first?: boolean
  boundary?: TranscriptBoundary
  width?: number
}) {
  const resolvedBoundary = first ? "none" : boundary ?? "space"
  const contentWidth = Math.max(1, width ?? 80)
  return (
    <Box flexDirection="column" width={contentWidth} marginTop={resolvedBoundary === "space" ? 1 : 0}>
      {resolvedBoundary === "divider" ? <Box width={contentWidth} marginTop={1} marginBottom={1}><Text color={tuiTheme.border}>{"─".repeat(contentWidth)}</Text></Box> : null}
      {children}
    </Box>
  )
}
