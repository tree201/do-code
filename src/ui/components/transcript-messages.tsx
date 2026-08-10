import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
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
      <Text color={tuiTheme.accent}>{language === "zh" ? "已恢复会话" : "Resumed session"}: {item.title}</Text>
      <Text dimColor>{language === "zh"
        ? `已恢复 ${item.visibleCount}/${item.conversationCount} 条对话${item.toolCount ? ` · ${item.toolCount} 个历史工具动作（只读，不会重新执行）` : ""}`
        : `Restored ${item.visibleCount}/${item.conversationCount} conversation messages${item.toolCount ? ` · ${item.toolCount} historical tool action${item.toolCount === 1 ? "" : "s"} (read-only; never rerun)` : ""}`}</Text>
    </MessageRow>
  )
}

export function UserMessage({ item, width }: ItemProps<Extract<TranscriptItem, { kind: "user" }>>) {
  return <UserMessageRow width={width}><Text wrap="wrap">{item.text}</Text></UserMessageRow>
}

export function AssistantMessage({ item, width }: ItemProps<Extract<TranscriptItem, { kind: "assistant" }>>) {
  const markdown = <MarkdownText width={Math.max(1, width - MESSAGE_PREFIX_WIDTH)} trimBoundarySpacing>{item.text}</MarkdownText>
  return item.continuation
    ? <MessageContinuation marginTop={1}>{markdown}</MessageContinuation>
    : <MessageRow ariaLabel="Assistant:">{markdown}</MessageRow>
}

export function PlanTranscript({ item, language, width }: ItemProps<Extract<TranscriptItem, { kind: "plan" }>>) {
  const zh = language === "zh"
  return (
    <MessageRow prefix={STATUS_DOT} color={tuiTheme.accent} ariaLabel={zh ? "计划：" : "Plan:"}>
      <Text bold>{zh ? "建议计划" : "Proposed Plan"}</Text>
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
