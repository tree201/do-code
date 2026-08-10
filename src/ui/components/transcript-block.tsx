import React from "react"
import type { ReactNode } from "react"
import { Box } from "ink"

export function TranscriptBlock({ children, first = false }: {
  children?: ReactNode
  first?: boolean
}) {
  return <Box flexDirection="column" marginTop={first ? 0 : 1}>{children}</Box>
}
