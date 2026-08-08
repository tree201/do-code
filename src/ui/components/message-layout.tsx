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
  marginBottom = 1,
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
export function MessageContinuation({ children, marginBottom = 0 }: { children: ReactNode; marginBottom?: number }) {
  return <Box flexDirection="column" paddingLeft={MESSAGE_PREFIX_WIDTH} marginBottom={marginBottom}>{children}</Box>
}

/** Codex-style turn boundary: a quiet full-width surface reserved for user input. */
export function UserMessageRow({ children, width }: { children: ReactNode; width: number }) {
  return (
    <Box
      width={Math.max(1, width)}
      flexDirection="row"
      minHeight={3}
      alignItems="center"
      backgroundColor={tuiTheme.userMessageBackground}
      marginBottom={1}
      paddingRight={1}
      aria-label="User:"
    >
      <Box width={MESSAGE_PREFIX_WIDTH} flexShrink={0}>
        <Text bold color={tuiTheme.accent}>›</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column">{children}</Box>
    </Box>
  )
}

export function StatusMessage({
  kind,
  children,
  marginBottom = 1,
}: {
  kind: "info" | "success" | "warning" | "error"
  children: ReactNode
  marginBottom?: number
}) {
  const appearance = {
    info: { color: tuiTheme.accent, ariaLabel: "Information:" },
    success: { color: tuiTheme.success, ariaLabel: "Success:" },
    warning: { color: tuiTheme.warning, ariaLabel: "Warning:" },
    error: { color: tuiTheme.danger, ariaLabel: "Error:" },
  }[kind]
  return (
    <MessageRow prefix={STATUS_DOT} color={appearance.color} ariaLabel={appearance.ariaLabel} marginBottom={marginBottom}>
      {children}
    </MessageRow>
  )
}
