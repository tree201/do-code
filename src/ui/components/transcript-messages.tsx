import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import { t } from "../i18n.js"
import { MarkdownText, ToolOutput } from "../markdown.js"
import { planMarkdown, type TranscriptItem } from "../transcript-model.js"
import { tuiTheme } from "../theme.js"
import { MESSAGE_PREFIX_WIDTH, MessageContinuation, MessageRow, STATUS_DOT, StatusMessage, UserMessageRow } from "./message-layout.js"

type ItemProps<Item extends TranscriptItem> = {
  item: Item
  width: number
  language: DoCodeLanguage
}

export function ResumeMessage({ item, language }: ItemProps<Extract<TranscriptItem, { kind: "resume" }>>) {
  return (
    <MessageRow prefix={STATUS_DOT} color={tuiTheme.accent}>
      <Text color={tuiTheme.accent}>{t(language, "Resumed session")}: {item.title}</Text>
      <Text dimColor>{t(language, "Restored {visibleCount}/{conversationCount} conversation messages{tools}", {
        visibleCount: item.visibleCount,
        conversationCount: item.conversationCount,
        tools: item.toolCount ? t(language, " · {count} historical tool action{plural} (read-only; never rerun)", { count: item.toolCount, plural: item.toolCount === 1 ? "" : "s" }) : "",
      })}</Text>
    </MessageRow>
  )
}

export function UserMessage({ item, width }: ItemProps<Extract<TranscriptItem, { kind: "user" }>>) {
  return <UserMessageRow width={width}><Text wrap="wrap">{item.text}</Text></UserMessageRow>
}

export function AssistantMessage({ item, width, language }: ItemProps<Extract<TranscriptItem, { kind: "assistant" }>>) {
  const markdown = <MarkdownText width={Math.max(1, width - MESSAGE_PREFIX_WIDTH)} trimBoundarySpacing>{item.text}</MarkdownText>
  return item.continuation
    ? <MessageContinuation marginTop={1}>{markdown}</MessageContinuation>
    : <MessageRow ariaLabel={t(language, "Assistant:")}>{markdown}</MessageRow>
}

export function PlanTranscript({ item, language, width }: ItemProps<Extract<TranscriptItem, { kind: "plan" }>>) {
  return (
    <MessageRow prefix={STATUS_DOT} color={tuiTheme.accent} ariaLabel={t(language, "Plan:")}>
      <Text bold>{t(language, "Proposed Plan")}</Text>
      <Box width={Math.max(20, width - MESSAGE_PREFIX_WIDTH)} marginTop={1} paddingX={1} paddingY={1} flexDirection="column" backgroundColor={tuiTheme.userMessageBackground}>
        <MarkdownText width={Math.max(18, width - MESSAGE_PREFIX_WIDTH - 2)}>{planMarkdown(item.plan, language)}</MarkdownText>
      </Box>
    </MessageRow>
  )
}

export function SystemNotice({ item }: ItemProps<Extract<TranscriptItem, { kind: "info" | "error" }>>) {
  if (item.kind === "error") return <StatusMessage kind="error"><Text color={tuiTheme.danger} wrap="wrap">{item.text}</Text></StatusMessage>
  return <StatusMessage kind="info"><ToolOutput>{item.text}</ToolOutput></StatusMessage>
}
