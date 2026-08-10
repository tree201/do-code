import { Box, Text } from "ink"
import React from "react"
import type { ReactNode } from "react"
import { tuiTheme } from "../theme.js"

/** One marker cell plus one separating cell, matching Gemini's conversation grid. */
export const MESSAGE_PREFIX_WIDTH = 2
export const STATUS_DOT = "•"

export type MessageRowProps = {
  prefix?: ReactNode
  children: ReactNode
  color?: string
  ariaLabel?: string
  marginTop?: number
  marginBottom?: number
}

/** Shared two-column history row. A missing prefix intentionally keeps the body aligned. */
export function MessageRow({
  prefix,
  children,
  color,
  ariaLabel,
  marginTop = 0,
  marginBottom = 0,
}: MessageRowProps) {
  return (
    <Box flexDirection="row" marginTop={marginTop} marginBottom={marginBottom}>
      <Box width={MESSAGE_PREFIX_WIDTH} flexShrink={0}>
        {prefix === undefined ? (ariaLabel ? <Text aria-label={ariaLabel}>{""}</Text> : null) : (
          <Text {...(color ? { color } : {})} {...(ariaLabel ? { "aria-label": ariaLabel } : {})}>{prefix}</Text>
        )}
      </Box>
      <Box flexGrow={1} flexDirection="column">{children}</Box>
    </Box>
  )
}

/** A continuation keeps the conversation body baseline without repeating a role marker. */
export function MessageContinuation({ children, marginTop = 0, marginBottom = 0 }: { children: ReactNode; marginTop?: number; marginBottom?: number }) {
  return <Box flexDirection="column" paddingLeft={MESSAGE_PREFIX_WIDTH} marginTop={marginTop} marginBottom={marginBottom}>{children}</Box>
}

/** Shared user-authored surface for history turns and the active composer. */
export function UserInputSurface({
  children,
  width,
  ariaLabel,
  active = false,
  paddingY = 1,
}: {
  children: ReactNode
  width?: number | string
  ariaLabel: string
  active?: boolean
  paddingY?: number
}) {
  return (
    <Box
      {...(typeof width === "number" ? { width: Math.max(1, width) } : width ? { width } : {})}
      flexDirection="row"
      backgroundColor={tuiTheme.userMessageBackground}
      paddingY={paddingY}
      paddingRight={1}
      aria-label={ariaLabel}
    >
      <Box width={MESSAGE_PREFIX_WIDTH} flexShrink={0}>
        <Text bold color={active ? tuiTheme.accent : tuiTheme.pending}>›</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column">{children}</Box>
    </Box>
  )
}

/** Codex-style turn boundary with stable vertical padding at every content height. */
export function UserMessageRow({ children, width }: { children: ReactNode; width: number }) {
  return <UserInputSurface width={width} ariaLabel="User:">{children}</UserInputSurface>
}

export function StatusMessage({
  kind,
  children,
  marginTop = 0,
  marginBottom = 0,
}: {
  kind: "info" | "success" | "warning" | "error"
  children: ReactNode
  marginTop?: number
  marginBottom?: number
}) {
  const appearance = {
    info: { color: tuiTheme.accent, ariaLabel: "Information:" },
    success: { color: tuiTheme.success, ariaLabel: "Success:" },
    warning: { color: tuiTheme.warning, ariaLabel: "Warning:" },
    error: { color: tuiTheme.danger, ariaLabel: "Error:" },
  }[kind]
  return (
    <MessageRow prefix={STATUS_DOT} color={appearance.color} ariaLabel={appearance.ariaLabel} marginTop={marginTop} marginBottom={marginBottom}>
      {children}
    </MessageRow>
  )
}
