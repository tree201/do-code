import { Box } from "ink"
import React from "react"
import type { ReactNode } from "react"
import { tuiTheme } from "../theme.js"

export function DialogManager({ children }: { children: ReactNode }) {
  return (
    <Box flexDirection="column" flexGrow={0} flexShrink={0}>
      {children}
    </Box>
  )
}

/** Consistent Gemini-style transient control surface. */
export function DialogSurface({ children, color = tuiTheme.accent }: { children?: ReactNode; color?: string }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginTop={1}>
      {children}
    </Box>
  )
}
