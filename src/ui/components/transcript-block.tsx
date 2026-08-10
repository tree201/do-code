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
  return (
    <Box flexDirection="column" marginTop={resolvedBoundary === "space" ? 1 : 0}>
      {resolvedBoundary === "divider" ? <Text color={tuiTheme.border} dimColor>{"─".repeat(Math.max(1, width ?? 80))}</Text> : null}
      {children}
    </Box>
  )
}
