import { Box } from "ink"
import React from "react"
import type { ReactNode } from "react"

export type DefaultAppLayoutProps = {
  width: number
  main: ReactNode
  controls: ReactNode
}

/** Gemini-style inline layout: static history followed by transient content and controls. */
export function DefaultAppLayout({ width, main, controls }: DefaultAppLayoutProps) {
  return (
    <Box
      flexDirection="column"
      width={width}
      flexGrow={0}
      flexShrink={0}
    >
      {main}
      <Box flexDirection="column" width={width} flexGrow={0} flexShrink={0}>
        {controls}
      </Box>
    </Box>
  )
}
