import { spawn } from "node:child_process"
import path from "node:path"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Box, Static, Text, render, useApp, useInput, useStdout } from "ink"
import { AgentConversation, type AgentEvent } from "../agent.js"
import { MaxSessionTurnsError } from "../turn-limits.js"
import type { Args } from "../cli-args.js"
import { listModelPresets, loadStoredConfig, normalizeLanguage, outputLanguageInstruction, resolveAgentProfile, resolveRuntimeModelConfig, saveLanguagePreference, type DoCodeLanguage, type ReasoningEffort, type RuntimeModelConfig, type SandboxNetworkMode, type ThinkingMode } from "../config.js"
import { createChatModel, type SwitchableModel } from "../model.js"
import { contentText, type Message, type ToolPresentation } from "../protocol.js"
import {
  exportSession,
  listSessions,
  loadSession,
  sessionTitleFromMessages,
  sessionsRoot,
  writeFileAtomic,
  type LoadedSession,
  type SavedSession,
} from "../sessions.js"
import { executeTool, type PlanProposal, type PlanReviewDecision, type TodoItem, type ToolResult } from "../tools.js"
import { approvalRequest, createPolicyEngine, isWorkspaceTrusted, setWorkspaceTrusted, type ApprovalChoice, type ApprovalMode, type PolicyEngine, type ToolApprovalRequest } from "../policy.js"
import { CheckpointManager } from "../checkpoints.js"
import { applyCompletion, completionsForEditor, type ArgumentCompletions } from "./completion.js"
import {
  backspaceEditor,
  createEditor,
  deleteEditor,
  editorCursorParts,
  insertEditorText,
  moveEditorCursor,
  moveEditorEnd,
  moveEditorHome,
  moveEditorVertical,
  redoEditor,
  type EditorState,
  undoEditor,
} from "./editor.js"
import { MarkdownText, ToolOutput } from "./markdown.js"
import { enqueueMessage, takeLastMessage, takeNextMessage } from "./message-queue.js"
import { reportError } from "../error-reports.js"
import { expandPromptExtension, loadPromptExtensions, type PromptExtension } from "../extension-registry.js"
import { HookRunner } from "../hooks.js"
import { McpManager } from "../mcp.js"
import { createSandboxShellRunner, createSandboxShellSpawnSpec } from "../sandbox.js"
import { DO_CODE_VERSION } from "../version.js"
import { languageDisplay, t } from "./i18n.js"
import { DefaultAppLayout } from "./layouts/default-app-layout.js"
import { Composer } from "./components/composer.js"
import { DialogManager, DialogSurface } from "./components/dialog-manager.js"
import { MESSAGE_PREFIX_WIDTH, MessageContinuation, MessageRow, STATUS_DOT, StatusMessage, UserMessageRow } from "./components/message-layout.js"
import { displayWidth, padTerminalEnd, truncateTerminal, truncateTerminalStart, wrapTerminalLines } from "./terminal-text.js"
import { activeToolSummary, type ToolSummaryItem } from "./tool-summary.js"
import { THINKING_BREATH_INTERVAL_MS, thinkingBreathColors, tuiTheme } from "./theme.js"
import { activityGroupKey, createToolPresentation } from "../tool-presentation.js"
import { buildActivitySummary, type ActivityDiffFile, type ActivitySummaryLine } from "./activity-summary.js"
import { ActivityDiff, ActivityDiffStats } from "./components/activity-diff.js"

type TranscriptTool = ToolSummaryItem & { callId?: string; step?: number }
type PendingToolGroup = { groupKey: string; step: number; tools: TranscriptTool[] }

export type TranscriptItem =
  | { id: number; kind: "header"; workspace: string; model: string; sessionId: string; restored: boolean; agent?: string }
  | { id: number; kind: "resume"; title: string; visibleCount: number; conversationCount: number; toolCount: number }
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string }
  | { id: number; kind: "plan"; plan: PlanProposal }
  | { id: number; kind: "tool"; tools: TranscriptTool[]; hidden?: boolean }
  | { id: number; kind: "info" | "error"; text: string }

type NewTranscriptItem = TranscriptItem extends infer Item
  ? Item extends { id: number }
    ? Omit<Item, "id">
    : never
  : never

type ApprovalRequest = ToolApprovalRequest & { resolve: (choice: ApprovalChoice) => void }
type UserQuestion = { question: string; options: string[]; resolve: (answer: string) => void }
type PlanReviewRequest = { plan: PlanProposal; resolve: (decision: PlanReviewDecision) => void }

export class ApprovalBridge {
  private handler: ((request: ApprovalRequest) => void) | null = null

  attach(handler: ((request: ApprovalRequest) => void) | null) {
    this.handler = handler
  }

  async request(request: ToolApprovalRequest) {
    return await new Promise<ApprovalChoice>((resolve) => {
      if (!this.handler) return resolve("deny")
      this.handler({ ...request, resolve })
    })
  }
}

export class QuestionBridge {
  private handler: ((request: UserQuestion) => void) | null = null
  attach(handler: ((request: UserQuestion) => void) | null) { this.handler = handler }
  async request(question: string, options: string[] = []) {
    return await new Promise<string>((resolve) => {
      if (!this.handler) return resolve("User input is unavailable")
      this.handler({ question, options, resolve })
    })
  }
}

export class PlanReviewBridge {
  private handler: ((request: PlanReviewRequest) => void) | null = null
  attach(handler: ((request: PlanReviewRequest) => void) | null) { this.handler = handler }
  async request(plan: PlanProposal) {
    return await new Promise<PlanReviewDecision>((resolve) => {
      if (!this.handler) return resolve("cancel")
      this.handler({ plan, resolve })
    })
  }
}

function planMarkdown(plan: PlanProposal, language: DoCodeLanguage) {
  const zh = language === "zh"
  const sections = [
    `# ${plan.title}`,
    `## ${zh ? "总体目标" : "Summary"}`,
    plan.summary,
    `## ${zh ? "执行步骤" : "Implementation"}`,
    ...plan.steps.map((step, index) => `### ${index + 1}. ${step}`),
  ]
  if (plan.files.length) sections.push(`## ${zh ? "涉及文件" : "Files"}`, ...plan.files.map((file) => `- \`${file}\``))
  if (plan.verification.length) sections.push(`## ${zh ? "验证方式" : "Verification"}`, ...plan.verification.map((item) => `- ${item}`))
  if (plan.risks.length) sections.push(`## ${zh ? "风险" : "Risks"}`, ...plan.risks.map((item) => `- ${item}`))
  return sections.join("\n\n")
}

export function PlanReviewDialog({ plan, selectedIndex, language, width = 80 }: { plan: PlanProposal; selectedIndex: number; language: DoCodeLanguage; width?: number }) {
  const zh = language === "zh"
  const choices = zh
    ? ["执行", "修改", "取消"]
    : ["Execute", "Revise", "Cancel"]
  return (
    <DialogManager><DialogSurface>
      <Text bold>• {zh ? "建议计划" : "Proposed Plan"}</Text>
      <Box width={Math.max(20, width - 4)} marginTop={1} paddingX={1} flexDirection="column" backgroundColor={tuiTheme.userMessageBackground}>
        <Text bold wrap="wrap">{plan.title}</Text>
        <Text dimColor wrap="wrap">{zh ? "完整计划已写入上方对话历史，可滚动查看。" : "The complete plan is in the transcript above and remains available in terminal scrollback."}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {choices.map((choice, index) => <Text key={choice} inverse={selectedIndex === index} color={index === 2 ? tuiTheme.danger : selectedIndex === index ? tuiTheme.accent : tuiTheme.border}>{selectedIndex === index ? "›" : " "} {index + 1}. {choice}</Text>)}
      </Box>
      <Box marginTop={1}><Text dimColor>{zh ? "↑↓ 选择 · Enter 确认 · Esc 取消" : "↑↓ Select · Enter Confirm · Esc Cancel"}</Text></Box>
    </DialogSurface></DialogManager>
  )
}

function PlanTranscript({ plan, language, width }: { plan: PlanProposal; language: DoCodeLanguage; width: number }) {
  const zh = language === "zh"
  return (
    <MessageRow prefix={STATUS_DOT} color={tuiTheme.accent} ariaLabel={zh ? "计划：" : "Plan:"}>
      <Text bold>{zh ? "建议计划" : "Proposed Plan"}</Text>
      <Box width={Math.max(20, width - MESSAGE_PREFIX_WIDTH)} marginTop={1} paddingX={1} flexDirection="column" backgroundColor={tuiTheme.userMessageBackground}>
        <MarkdownText width={Math.max(18, width - MESSAGE_PREFIX_WIDTH - 2)}>{planMarkdown(plan, language)}</MarkdownText>
      </Box>
    </MessageRow>
  )
}

export function PermissionModeDialog({ currentMode, selectedIndex, language }: { currentMode: ApprovalMode; selectedIndex: number; language: DoCodeLanguage }) {
  const zh = language === "zh"
  const modes: ApprovalMode[] = ["ask", "auto", "full-access"]
  const labels = zh
    ? ["请求批准", "自动批准安全操作", "完全访问"]
    : ["Ask for approval", "Approve for me", "Full Access"]
  const descriptions = zh
    ? [
        "可读取和编辑当前工作区并运行普通命令；访问网络或工作区外文件时请求确认。",
        "自动执行普通编辑、命令和联网操作；仅对检测为可能不安全的操作请求确认。",
        "可编辑工作区外文件并访问网络，不再请求普通审批。请谨慎使用。",
      ]
    : [
        "Read and edit the current workspace and run ordinary commands; ask before network or outside-workspace access.",
        "Automatically run ordinary edits, commands, and network access; ask only for potentially unsafe actions.",
        "Edit files outside the workspace and access the network without ordinary approval prompts. Use with caution.",
      ]
  return (
    <DialogManager><DialogSurface>
      <Text bold>{zh ? "更新模型权限" : "Update Model Permissions"}</Text>
      <Box marginTop={1} flexDirection="column">
        {modes.map((mode, index) => {
          const selected = selectedIndex === index
          const current = currentMode === mode
          return <Text key={mode} inverse={selected} color={selected ? tuiTheme.accent : tuiTheme.border}>
            {selected ? "›" : " "} {index + 1}. {labels[index]}{current ? (zh ? "（当前）" : " (current)") : ""}  <Text dimColor={!selected}>{descriptions[index]}</Text>
          </Text>
        })}
      </Box>
      <Box marginTop={1}><Text dimColor>{zh ? "↑↓ 选择 · Enter 确认 · Esc 取消" : "↑↓ Select · Enter Confirm · Esc Cancel"}</Text></Box>
    </DialogSurface></DialogManager>
  )
}

export function QuestionDialog({ question, options, selectedIndex, draft, language }: {
  question: string
  options: string[]
  selectedIndex: number
  draft: string
  language: DoCodeLanguage
}) {
  const hasOptions = options.length > 0
  return (
    <DialogManager><DialogSurface>
      <Text bold>{language === "zh" ? "需要你的输入" : "Agent needs your input"}</Text>
      <Box height={1} />
      <Text wrap="wrap">{question}</Text>
      <Box flexDirection="column" marginTop={1} paddingLeft={1}>
        {hasOptions
          ? options.map((option, index) => (
            <Text key={`${index}-${option}`} wrap="wrap" inverse={selectedIndex === index}>
              {selectedIndex === index ? "›" : " "} {option}
            </Text>
          ))
          : <Text><Text color={tuiTheme.accent}>› </Text>{draft}<Text inverse> </Text></Text>}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{hasOptions
          ? language === "zh" ? "↑↓ 选择 · Enter 确认 · Esc 取消" : "↑↓ Select · Enter Answer · Esc Cancel"
          : language === "zh" ? "输入回答 · Enter 发送 · Esc 取消" : "Type an answer · Enter Send · Esc Cancel"}</Text>
      </Box>
    </DialogSurface></DialogManager>
  )
}

function commandOutput(command: string, args: string[], cwd: string) {
  return new Promise<string>((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.on("error", (error) => resolve(error.message))
    child.on("close", () => resolve(output.trim()))
  })
}

function preview(value: string, length = 900) {
  const normalized = value.trim()
  return truncateTerminal(normalized, length)
}

const CONCURRENT_SLASH_COMMANDS = new Set(["/help", "/status", "/stats", "/permissions", "/approval-mode", "/trust", "/untrust", "/extensions", "/language", "/exit", "/quit"])

function canRunSlashCommandDuringTask(input: string) {
  const command = input.trim().split(/\s+/, 1)[0] ?? ""
  return CONCURRENT_SLASH_COMMANDS.has(command) || input.trim() === "/model"
}

export function composerStatusText(options: {
  language: DoCodeLanguage
  running: boolean
  command: boolean
  width: number
  model: string
  reasoningIntensity?: string
  thinkingMode?: ThinkingMode
  contextPercent: number
  approvalMode: ApprovalMode
  planMode?: boolean
}) {
  const { language, width, contextPercent } = options
  const model = options.model.split("/").at(-1) ?? options.model
  const reasoningIntensity = options.reasoningIntensity ?? "default"
  const intensity = language === "zh" && reasoningIntensity === "default" ? "默认" : reasoningIntensity
  const context = `${contextPercent}%`
  const candidates = [
    [model, intensity, context],
    [model, context],
    [model],
  ].map((parts) => parts.filter(Boolean).join(" · "))
  const available = Math.max(1, width - 4)
  return candidates.find((candidate) => displayWidth(candidate) <= available) ?? truncateTerminal(model, available)
}

export function approvalModeNotice(mode: ApprovalMode, language: DoCodeLanguage) {
  const descriptions: Record<ApprovalMode, [string, string]> = {
    ask: [
      "允许读取和编辑当前工作区并运行普通命令；联网、工作区外访问和高风险操作会请求确认。",
      "Allow current-workspace reads, edits, and ordinary commands; ask before network, outside-workspace, and high-risk actions.",
    ],
    auto: [
      "自动执行普通编辑、Shell 和联网操作；仅对检测为可能不安全的操作请求确认。",
      "Automatically run ordinary edits, shell commands, and network access; ask only for potentially unsafe actions.",
    ],
    "full-access": [
      "允许编辑工作区外文件和访问网络，不再请求普通审批；灾难性系统命令仍会被阻止。",
      "Allow edits outside the workspace and network access without ordinary approval prompts; catastrophic system commands remain blocked.",
    ],
  }
  const labels: Record<ApprovalMode, string> = { ask: "请求批准", auto: "自动批准安全操作", "full-access": "完全访问" }
  const title = language === "zh" ? `审批模式：${labels[mode]}（${mode}）` : `Approval mode: ${mode}`
  return `${title}\n${descriptions[mode][language === "zh" ? 0 : 1]}`
}

const DO_CODE_LOGO = [
  "  ____   ___   ",
  " |  _ \\ / _ \\  ",
  " | | | | | | | ",
  " | |_| | |_| | ",
  " |____/ \\___/  ",
]

function compactPath(workspace: string, maxLength: number) {
  const home = process.env.HOME
  const display = home && (workspace === home || workspace.startsWith(`${home}${path.sep}`))
    ? `~${workspace.slice(home.length)}`
    : workspace
  if (displayWidth(display) <= maxLength) return display
  const name = path.basename(display)
  if (displayWidth(name) + 6 >= maxLength) {
    return truncateTerminalStart(display, maxLength)
  }
  const prefixWidth = Math.max(1, maxLength - displayWidth(name) - 5)
  return `${truncateTerminal(display, prefixWidth, "")}/…/${name}`
}

export function WelcomeHeader({ workspace, model, sessionId, restored, width, agent, language = "en" }: {
  workspace: string
  model: string
  sessionId: string
  restored: boolean
  width: number
  agent?: string
  language?: DoCodeLanguage
}) {
  const horizontalMargin = width >= 36 ? 2 : 0
  const outerWidth = Math.max(16, width - horizontalMargin)
  const showLogo = width >= 76
  const logoWidth = Math.max(...DO_CODE_LOGO.map((line) => line.length))
  const gap = 3
  const panelWidth = showLogo ? Math.min(62, outerWidth - logoWidth - gap) : outerWidth
  const contentWidth = Math.max(1, panelWidth - 4)
  const workspaceLabel = compactPath(workspace, Math.max(1, contentWidth - 11))
  const sessionLabel = truncateTerminal(sessionId, Math.max(5, contentWidth - 9))
  const modelLabel = truncateTerminal(model, Math.max(1, contentWidth - 11))
  const agentLabel = agent ? truncateTerminal(agent, Math.max(1, contentWidth - 11)) : undefined
  const label = (value: string) => padTerminalEnd(value, 11)

  return (
    <Box flexDirection="column" marginBottom={1} marginX={width >= 36 ? 1 : 0}>
      <Box alignItems="center">
        {showLogo ? (
          <Box flexDirection="column" flexShrink={0} marginRight={gap}>
            {DO_CODE_LOGO.map((line, index) => (
              <Text key={`${index}-${line}`} bold color={tuiTheme.brand}>{line}</Text>
            ))}
          </Box>
        ) : null}
        <Box flexDirection="column" borderStyle="round" borderColor={tuiTheme.border} paddingX={1} width={panelWidth}>
          <Text>
            <Text bold color={tuiTheme.brand}>›_ do-code</Text>
            {width >= 30 ? <Text dimColor>  v{DO_CODE_VERSION}</Text> : null}
            {restored ? <Text color={tuiTheme.success}>  {t(language, "resumed")}</Text> : null}
          </Text>
          {width >= 48 ? <Text dimColor>{t(language, "let's do it!")}</Text> : null}
          <Text>{label(t(language, "Model"))}<Text color={tuiTheme.accent}>{modelLabel}</Text></Text>
          {agentLabel ? <Text>{label(t(language, "Agent"))}<Text color={tuiTheme.accent}>{agentLabel}</Text></Text> : null}
          <Text>{label(t(language, "Workspace"))}<Text dimColor>{workspaceLabel}</Text></Text>
          <Text>{label(t(language, "Session"))}<Text dimColor>{sessionLabel}</Text></Text>
        </Box>
      </Box>
      <Box marginTop={1} marginLeft={showLogo && width >= 100 ? logoWidth + gap : 1}>
        <Text bold>{t(language, "Tip")}</Text>
        {language === "zh"
          ? <><Text dimColor>  输入 </Text><Text color={tuiTheme.accent}>/</Text><Text dimColor> 打开命令</Text></>
          : <><Text dimColor>  Type </Text><Text color={tuiTheme.accent}>/</Text><Text dimColor>{width >= 48 ? " for commands" : "help"}</Text></>}
        {width >= 48 ? <><Text dimColor> · </Text><Text color={tuiTheme.accent}>@</Text><Text dimColor> {t(language, "to attach files")}</Text></> : null}
        {width >= 72 ? <><Text dimColor> · </Text><Text color={tuiTheme.accent}>/help</Text><Text dimColor> {t(language, "for help")}</Text></> : null}
      </Box>
    </Box>
  )
}

function ActivityDetailLine({ line }: { line: ActivitySummaryLine }) {
  const color = line.tone === "accent"
    ? tuiTheme.accent
    : line.tone === "success"
      ? tuiTheme.success
      : line.tone === "danger"
        ? tuiTheme.danger
        : undefined
  return <Text {...(color ? { color } : {})} dimColor={line.tone === "muted"} wrap="wrap">{line.text}</Text>
}

export function TranscriptLine({ item, width, language = "en", nextKind }: { item: TranscriptItem; width: number; language?: DoCodeLanguage; nextKind?: TranscriptItem["kind"] }) {
  if (item.kind === "header") {
    return <WelcomeHeader {...item} width={width} language={language} />
  }
  if (item.kind === "resume") {
    return (
      <MessageRow prefix={STATUS_DOT} color={tuiTheme.accent}>
        <Text color={tuiTheme.accent}>{language === "zh" ? "已恢复会话" : "Resumed session"}: {item.title}</Text>
        <Text dimColor>{language === "zh"
          ? `已恢复 ${item.visibleCount}/${item.conversationCount} 条对话${item.toolCount ? ` · ${item.toolCount} 个历史工具动作（只读，不会重新执行）` : ""}`
          : `Restored ${item.visibleCount}/${item.conversationCount} conversation messages${item.toolCount ? ` · ${item.toolCount} historical tool action${item.toolCount === 1 ? "" : "s"} (read-only; never rerun)` : ""}`}</Text>
      </MessageRow>
    )
  }
  if (item.kind === "user") {
    return (
      <UserMessageRow width={width}>
        <Text wrap="wrap">{item.text}</Text>
      </UserMessageRow>
    )
  }
  if (item.kind === "assistant") {
    return (
      <MessageRow ariaLabel="Assistant:">
        <MarkdownText width={Math.max(1, width - MESSAGE_PREFIX_WIDTH)}>{item.text}</MarkdownText>
      </MessageRow>
    )
  }
  if (item.kind === "plan") {
    return <PlanTranscript plan={item.plan} language={language} width={width} />
  }
  if (item.kind === "tool") {
    if (item.hidden) return null
    const ok = activitySucceeded(item.tools)
    const summary = buildActivitySummary(item.tools, language)
    const singleSuccessfulDiff = ok && summary.diffs?.length === 1 ? summary.diffs[0] : undefined
    const hasMultiFileDiff = (summary.diffs?.length ?? 0) > 1
    return (
      <Box flexDirection="column" width={Math.max(1, width)} marginBottom={nextKind === "tool" && !hasMultiFileDiff ? 0 : 1}>
        <MessageRow prefix={STATUS_DOT} color={ok ? tuiTheme.success : tuiTheme.danger} ariaLabel={ok ? "Tools succeeded:" : "Tool failed:"} marginBottom={0}>
          {singleSuccessfulDiff ? (
            <Text bold wrap="truncate-end">
              {language === "zh" ? "修改 " : "Edited "}{singleSuccessfulDiff.path}
              <ActivityDiffStats file={singleSuccessfulDiff} />
            </Text>
          ) : <Text bold wrap="truncate-end">{summary.title}</Text>}
          {summary.lines.map((line, index) => (
            <Box key={`${index}-${line.text}`} paddingLeft={2}>
              <Text dimColor>{index === 0 ? "└ " : "  "}</Text>
              <Box flexGrow={1}><ActivityDetailLine line={line} /></Box>
            </Box>
          ))}
        </MessageRow>
        {summary.diffs?.map((file, index) => (
          <ActivityDiff
            key={`${index}-${file.path}`}
            file={file}
            width={Math.max(12, width)}
            language={language}
            showHeader={!singleSuccessfulDiff}
          />
        ))}
      </Box>
    )
  }
  if (item.kind === "error") {
    return <StatusMessage kind="error"><Text color={tuiTheme.danger} wrap="wrap">{item.text}</Text></StatusMessage>
  }
  return <StatusMessage kind="info"><ToolOutput>{item.text}</ToolOutput></StatusMessage>
}

export function transcriptViewerText(items: TranscriptItem[], language: DoCodeLanguage) {
  const zh = language === "zh"
  return items.flatMap((item) => {
    if (item.kind === "header") return []
    if (item.kind === "resume") return [`• ${zh ? "已恢复会话" : "Resumed session"}: ${item.title}`]
    if (item.kind === "user") return [`› ${zh ? "你" : "You"}\n${item.text}`]
    if (item.kind === "assistant") return [`• do-code\n${item.text}`]
    if (item.kind === "plan") return [`• ${zh ? "建议计划" : "Proposed Plan"}\n${planMarkdown(item.plan, language)}`]
    if (item.kind === "error" || item.kind === "info") return [item.kind === "error" ? `× ${zh ? "错误" : "Error"}\n${item.text}` : `• ${item.text}`]
    if (item.kind !== "tool") return []
    return item.tools.map((tool) => {
      const status = tool.ok ? "✓" : "×"
      const args = tool.args === undefined ? "" : `\n${JSON.stringify(tool.args, null, 2)}`
      return `${status} ${tool.name}${args}\n${tool.output}`
    })
  }).join("\n\n")
}

export function todoItemsFromArgs(args: unknown): TodoItem[] {
  if (typeof args !== "object" || args === null) return []
  const items = (args as Record<string, unknown>).items
  if (!Array.isArray(items)) return []
  return items.flatMap((value) => {
    if (typeof value !== "object" || value === null) return []
    const item = value as Record<string, unknown>
    const status = item.status
    if (typeof item.id !== "string" || typeof item.content !== "string" || !["pending", "in_progress", "completed", "cancelled", "blocked"].includes(String(status))) return []
    return [{ id: item.id, content: item.content, status: status as TodoItem["status"] }]
  })
}

function blockedTodoCount(tools: TranscriptTool[]) {
  return tools.filter((tool) => tool.name === "todo_write").reduce((total, tool) => total + todoItemsFromArgs(tool.args).filter((item) => item.status === "blocked").length, 0)
}

function activitySucceeded(tools: TranscriptTool[]) {
  return tools.every((tool) => tool.ok) && blockedTodoCount(tools) === 0
}

export const TranscriptViewer = React.memo(function TranscriptViewer({ items, offset, width, height, language }: { items: TranscriptItem[]; offset: number; width: number; height: number; language: DoCodeLanguage }) {
  const zh = language === "zh"
  const contentWidth = Math.max(8, width - 4)
  const rows = Math.max(3, height - 4)
  // Keep the expensive transcript serialization and wrapping independent from
  // the scroll anchor. Arrow-key scrolling should only select another small
  // viewport, not rebuild thousands of historical lines on every keypress.
  const lines = useMemo(
    () => wrapTerminalLines(transcriptViewerText(items, language), contentWidth),
    [contentWidth, items, language],
  )
  const maximum = Math.max(0, lines.length - rows)
  const start = Math.min(maximum, Math.max(0, offset))
  const visible = lines.slice(start, start + rows)
  return <Box
    flexDirection="column"
    borderStyle="round"
    borderColor={tuiTheme.accent}
    paddingX={1}
    width={Math.max(12,width)}
    height={height}
    minHeight={height}
    flexGrow={0}
    flexShrink={0}
    overflow="hidden"
  >
    <Text bold color={tuiTheme.accent}>{zh ? "消息查看模式" : "Message viewer"}<Text dimColor>  {lines.length ? `${start + 1}-${Math.min(lines.length,start + rows)}/${lines.length}` : "0/0"}</Text></Text>
    {visible.map((line,index)=><Text key={`${start+index}-${line}`} wrap="truncate-end">{line || " "}</Text>)}
    {visible.length < rows ? <Box height={rows - visible.length} flexShrink={0} /> : null}
    <Text dimColor wrap="truncate-end">{zh ? "↑↓ · PgUp/PgDn · Home/End · Ctrl+T/Esc 返回" : "↑↓ · PgUp/PgDn · Ctrl+T/Esc Back"}</Text>
  </Box>
})

type ViewerInputKey = {
  ctrl?: boolean
  escape?: boolean
  upArrow?: boolean
  downArrow?: boolean
  pageUp?: boolean
  pageDown?: boolean
  home?: boolean
  end?: boolean
}

export class ViewerInputBridge {
  private handler: ((input: string, key: ViewerInputKey) => void) | null = null
  attach(handler: ((input: string, key: ViewerInputKey) => void) | null) { this.handler = handler }
  dispatch(input: string, key: ViewerInputKey) { this.handler?.(input, key) }
}

export function AlternateTranscriptViewer({ items, language, onClose, inputBridge }: {
  items: TranscriptItem[]
  language: DoCodeLanguage
  onClose: () => void
  inputBridge: ViewerInputBridge
}) {
  const { stdout } = useStdout()
  const [width, setWidth] = useState(() => stdout.columns || 80)
  const [height, setHeight] = useState(() => stdout.rows || 24)
  const [offset, setOffset] = useState(Number.MAX_SAFE_INTEGER)
  const contentWidth = Math.max(8, width - 4)
  const rows = Math.max(3, height - 4)
  const lineCount = useMemo(
    () => wrapTerminalLines(transcriptViewerText(items, language), contentWidth).length,
    [contentWidth, items, language],
  )
  const maximum = Math.max(0, lineCount - rows)
  const effectiveOffset = Math.min(maximum, Math.max(0, offset))

  useEffect(() => {
    const updateSize = () => {
      setWidth(stdout.columns || 80)
      setHeight(stdout.rows || 24)
    }
    stdout.on("resize", updateSize)
    return () => { stdout.off("resize", updateSize) }
  }, [stdout])

  const handleInput = useCallback((input: string, key: ViewerInputKey) => {
    const isCtrlT = key.ctrl && (input.toLowerCase() === "t" || input === "\u0014")
    if (isCtrlT || key.escape || input === "q" || (key.ctrl && input.toLowerCase() === "c")) { onClose(); return }
    if (key.upArrow) { setOffset(Math.max(0, effectiveOffset - 1)); return }
    if (key.downArrow) { setOffset(Math.min(maximum, effectiveOffset + 1)); return }
    if (key.pageUp) { setOffset(Math.max(0, effectiveOffset - rows)); return }
    if (key.pageDown) { setOffset(Math.min(maximum, effectiveOffset + rows)); return }
    if (key.home) { setOffset(0); return }
    if (key.end) setOffset(maximum)
  }, [effectiveOffset, maximum, onClose, rows])

  useEffect(() => {
    inputBridge.attach(handleInput)
    return () => { inputBridge.attach(null) }
  }, [handleInput, inputBridge])

  return <TranscriptViewer
    items={items}
    offset={effectiveOffset}
    width={width}
    height={Math.max(5, height)}
    language={language}
  />
}

export type PausableOutput = {
  stdout: NodeJS.WriteStream
  pause: () => void
  resume: (replay?: boolean) => void
}

/**
 * Give the long-lived inline renderer its own stream identity so a temporary
 * alternate-buffer Ink instance can coexist with it. While the viewer owns the
 * physical terminal, parent diffs are queued and replayed as one synchronized
 * update after the primary screen returns.
 */
export function createPausableOutput(target: NodeJS.WriteStream): PausableOutput {
  let paused = false
  let pending: Array<string | Uint8Array> = []
  const stdout = new Proxy(target, {
    get(stream, property) {
      if (property === "write") {
        return (...args: unknown[]) => {
          if (!paused) return (stream.write as (...values: unknown[]) => boolean).apply(stream, args)
          const chunk = args[0]
          if (typeof chunk === "string" || chunk instanceof Uint8Array) pending.push(chunk)
          const callback = [...args].reverse().find((value) => typeof value === "function") as (() => void) | undefined
          if (callback) queueMicrotask(callback)
          return true
        }
      }
      const value = Reflect.get(stream, property, stream) as unknown
      return typeof value === "function" ? value.bind(stream) : value
    },
    set(stream, property, value) {
      return Reflect.set(stream, property, value, stream)
    },
  }) as NodeJS.WriteStream
  return {
    stdout,
    pause: () => {
      if (paused) return
      pending = []
      paused = true
    },
    resume: (replay = true) => {
      paused = false
      if (!pending.length) return
      if (!replay) {
        pending = []
        return
      }
      // Replaying the exact diff stream brings the restored primary screen to
      // the latest background agent state. Synchronized output prevents the
      // queued intermediate frames from becoming visible as flicker.
      target.write("\u001b[?2026h")
      for (const chunk of pending) target.write(chunk)
      target.write("\u001b[?2026l")
      pending = []
    },
  }
}

const PendingToolSummary = React.memo(function PendingToolSummary({ tools, width, language }: { tools: TranscriptTool[]; width: number; language: DoCodeLanguage }) {
  const summary = useMemo(() => buildActivitySummary(tools, language), [language, tools])
  const ok = activitySucceeded(tools)
  return (
    <Box width={Math.max(1, width)}>
      <MessageRow prefix={STATUS_DOT} color={ok ? tuiTheme.success : tuiTheme.danger} marginBottom={0}>
        <Text bold wrap="truncate-end">{summary.title}</Text>
      </MessageRow>
    </Box>
  )
})

function Spinner({ label, animate = true, language }: { label: string; animate?: boolean; language: DoCodeLanguage }) {
  const [breathPhase, setBreathPhase] = useState(0)
  useEffect(() => {
    if (!animate) return
    const timer = setInterval(() => setBreathPhase((value) => (value + 1) % thinkingBreathColors.length), THINKING_BREATH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [animate])
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!animate) return
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [animate])
  const breathColor = animate ? thinkingBreathColors[breathPhase]! : thinkingBreathColors.at(-1)!
  return (
    <MessageRow prefix={STATUS_DOT} color={breathColor} marginTop={1} marginBottom={0}>
      <Text color={breathColor}>{label}{animate ? ` · ${formatElapsedTime(elapsed)}` : ""}{language === "zh" ? " · Esc 停止" : " · Esc stop"}</Text>
    </MessageRow>
  )
}

export function formatElapsedTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  if (total < 60) return `${total}s`
  if (total < 3_600) {
    const minutes = Math.floor(total / 60)
    const remaining = total % 60
    return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`
  }
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor(total % 3_600 / 60)
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

function approvalEditDiff(request: ToolApprovalRequest): ActivityDiffFile | null {
  if (request.tool !== "edit_file") return null
  const before = typeof request.args.old_text === "string" ? request.args.old_text : ""
  const after = typeof request.args.new_text === "string" ? request.args.new_text : ""
  const removed = before.split("\n").map((text) => ({ kind: "remove" as const, text }))
  const added = after.split("\n").map((text) => ({ kind: "add" as const, text }))
  return {
    path: String(request.args.path ?? ""),
    stats: ` (+${added.length} -${removed.length})`,
    additions: added.length,
    deletions: removed.length,
    lines: [...removed, ...added],
    omitted: 0,
  }
}

function approvalLabels(request: ToolApprovalRequest, language: DoCodeLanguage) {
  const zh = language === "zh"
  const target = String(request.args.path ?? "")
  const risk = zh
    ? { low: "低风险", medium: "中等风险", high: "高风险", critical: "严重风险" }[request.risk]
    : { low: "low risk", medium: "medium risk", high: "high risk", critical: "critical risk" }[request.risk]
  if (request.tool === "edit_file") return { title: zh ? `修改 ${target}` : `Edit ${target}`, question: zh ? "允许修改这个文件吗？" : "Allow this file change?", risk }
  if (request.tool === "apply_patch" || request.tool === "write_file") return { title: zh ? "修改工作区文件" : "Modify workspace files", question: zh ? "允许应用这些文件修改吗？" : "Allow these workspace changes?", risk }
  if (request.tool === "shell" || request.tool === "shell_start" || request.tool === "shell_pty_start") return { title: zh ? "运行命令" : "Run command", question: zh ? "允许运行这个命令吗？" : "Allow this command?", risk }
  if (request.tool === "web_fetch" || request.tool === "web_search") return { title: zh ? "访问网络" : "Access network", question: zh ? "允许这次网络访问吗？" : "Allow this network request?", risk }
  return { title: zh ? `运行 ${request.tool}` : `Run ${request.tool}`, question: zh ? "允许执行这个操作吗？" : "Allow this action?", risk }
}

export function ApprovalDialog({ request, selectedIndex, language, width }: {
  request: ToolApprovalRequest
  selectedIndex: number
  language: DoCodeLanguage
  width: number
}) {
  const zh = language === "zh"
  const labels = approvalLabels(request, language)
  const diff = approvalEditDiff(request)
  const choices = zh
    ? ["允许一次", "本次会话允许", "始终允许此操作", "拒绝"]
    : ["Allow once", "Allow for this session", "Always allow this action", "Deny"]
  const detail = request.tool === "edit_file" ? "" : request.detail
  return (
    <DialogManager><DialogSurface color={request.dangerous ? tuiTheme.danger : tuiTheme.border}>
      <Text>
        <Text color={request.dangerous ? tuiTheme.danger : tuiTheme.accent}>• </Text>
        <Text bold>{labels.title}</Text>
        <Text dimColor>  {labels.risk}</Text>
      </Text>
      {diff ? <ActivityDiff file={diff} width={Math.max(12, width - 4)} language={language} showHeader={false} /> : null}
      {detail ? <Box marginTop={1}><Text dimColor wrap="wrap">{detail}</Text></Box> : null}
      <Box marginTop={1}><Text>{labels.question}</Text></Box>
      <Box marginTop={1} flexDirection="column">
        {choices.map((choice, index) => {
          const selected = selectedIndex === index
          const color = index === 3 ? tuiTheme.danger : selected ? tuiTheme.accent : tuiTheme.border
          return <Text key={choice} bold={selected} color={color}>{selected ? "›" : " "} {index + 1}. {choice}</Text>
        })}
      </Box>
      <Box marginTop={1}><Text dimColor>{zh ? "↑↓ 选择 · Enter 确认 · Esc 拒绝" : "↑↓ Select · Enter Confirm · Esc Deny"}</Text></Box>
    </DialogSurface></DialogManager>
  )
}

function QueuedMessages({ messages }: { messages: string[] }) {
  if (!messages.length) return null
  return (
    <StatusMessage kind="info" marginBottom={0}>
      <Text dimColor>{messages.length} queued (↑ to edit the latest)</Text>
      {messages.slice(0, 3).map((message, index) => <Text key={`${index}-${message}`} dimColor>{index + 1}. {preview(message.replace(/\s+/g, " "), 100)}</Text>)}
      {messages.length > 3 ? <Text dimColor>…and {messages.length - 3} more</Text> : null}
    </StatusMessage>
  )
}

export type ChatAppProps = {
  workspace: string
  model: string
  approvalMode: Args["approvalMode"]
  sessionId: string
  sessionTitle?: string
  restored: boolean
  agent?: string
  initialMessages: Message[]
  initialEvents?: unknown[]
  conversation: AgentConversation
  approvalBridge: ApprovalBridge
  questionBridge?: QuestionBridge
  planReviewBridge?: PlanReviewBridge
  policy?: PolicyEngine
  setApprovalMode?: (mode: ApprovalMode) => void
  setPlanMode?: (active: boolean) => void
  initialPlanMode?: boolean
  attachEventSink: (sink: ((event: AgentEvent) => void) | null) => void
  attachApprovalModeSink?: (sink: ((mode: ApprovalMode) => void) | null) => void
  attachPlanModeSink?: (sink: ((active: boolean) => void) | null) => void
  runShellShortcut: (command: string) => Promise<ToolResult>
  listSessions: () => Promise<SavedSession[]>
  resumeSession: (id: string) => Promise<LoadedSession>
  renameCurrentSession: (title: string) => Promise<SavedSession>
  exportCurrentSession: (format: "md" | "json", output?: string) => Promise<string>
  save: () => Promise<void>
  reportError: (error: unknown, operation: string, category?: "exception" | "bad_case", context?: unknown) => Promise<{ id: string; file: string }>
  modelPresets?: string[]
  promptExtensions?: PromptExtension[]
  switchModel?: (preset: string) => Promise<RuntimeModelConfig>
  reasoningEffort?: ReasoningEffort
  switchEffort?: (effort: ReasoningEffort) => Promise<RuntimeModelConfig>
  thinkingMode?: ThinkingMode
  switchThinking?: (mode: ThinkingMode) => Promise<RuntimeModelConfig>
  language?: DoCodeLanguage
  setLanguage?: (language: DoCodeLanguage) => Promise<void>
  openTranscriptViewer?: (items: TranscriptItem[], language: DoCodeLanguage) => Promise<void>
  forwardTranscriptViewerInput?: (input: string, key: ViewerInputKey) => void
  /** Invisible frame token used to force a physical repaint after a modal screen. */
  renderRevision?: number
}

export const INTERACTIVE_RENDER_OPTIONS = {
  exitOnCtrlC: false,
  patchConsole: false,
} as const

/**
 * Inline Ink output shares the shell's primary buffer. A transient view that
 * grows to (or close to) the terminal height forces a physical terminal
 * scroll, which cannot be undone when the short composer returns. Keep every
 * pageable transient view bounded, like the compact plan confirmation.
 */
export function inlineViewerHeight(terminalWidth: number, terminalHeight: number) {
  // Gemini CLI sizes its detailed-message viewport from terminal width. The
  // 0.2 factor compensates for terminal cells being much taller than wide,
  // producing a useful visual panel rather than an arbitrarily tiny one.
  const desiredHeight = Math.floor(Math.max(terminalWidth * 0.2, 5))
  const availableHeight = Math.max(5, terminalHeight - 8)
  return Math.max(5, Math.min(desiredHeight, availableHeight))
}

export function boundedLiveOutput(value: string, width: number, maxRows: number) {
  const columns = Math.max(12, width)
  const rowLimit = Math.max(1, maxRows)
  const rows: string[] = []
  for (const line of value.replaceAll("\r", "").split("\n")) {
    const characters = Array.from(line)
    if (!characters.length) rows.push("")
    else for (let offset = 0; offset < characters.length; offset += columns) rows.push(characters.slice(offset, offset + columns).join(""))
  }
  const truncated = rows.length > rowLimit
  return { text: rows.slice(-rowLimit).join("\n"), truncated }
}

type HistoricalToolEvent = {
  step?: number
  name?: string
  args?: unknown
  ok?: boolean
  output?: string
  presentation?: ToolPresentation
}

function historicalToolEvents(events: unknown[]) {
  const tools = new Map<string, HistoricalToolEvent>()
  for (const record of events) {
    if (typeof record !== "object" || record === null || !("event" in record)) continue
    const event = (record as { event?: unknown }).event
    if (typeof event !== "object" || event === null || !("type" in event) || !("callId" in event)) continue
    const value = event as Record<string, unknown>
    if (value.type !== "tool.started" && value.type !== "tool.completed") continue
    const callId = typeof value.callId === "string" ? value.callId : ""
    if (!callId) continue
    const current = tools.get(callId) ?? {}
    tools.set(callId, {
      ...current,
      ...(typeof value.step === "number" ? { step: value.step } : {}),
      ...(typeof value.name === "string" ? { name: value.name } : {}),
      ...("args" in value ? { args: value.args } : {}),
      ...(typeof value.ok === "boolean" ? { ok: value.ok } : {}),
      ...(typeof value.output === "string" ? { output: value.output } : {}),
      ...(typeof value.presentation === "object" && value.presentation !== null ? { presentation: value.presentation as ToolPresentation } : {}),
    })
  }
  return tools
}

function storedToolResult(content: string) {
  if (content.startsWith("OK: ")) return { ok: true, output: content.slice(4) }
  if (content.startsWith("ERROR: ")) return { ok: false, output: content.slice(7) }
  return { ok: true, output: content }
}

function storedToolArgs(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return { raw: value }
  }
}

function planProposalFromArgs(args: unknown): PlanProposal | null {
  if (typeof args !== "object" || args === null) return null
  const record = args as Record<string, unknown>
  if (typeof record.title !== "string" || typeof record.summary !== "string") return null
  if (!Array.isArray(record.steps) || !record.steps.every((step) => typeof step === "string")) return null
  const strings = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
  return {
    title: record.title,
    summary: record.summary,
    steps: record.steps,
    files: strings(record.files),
    verification: strings(record.verification),
    risks: strings(record.risks),
  }
}

export function askAnswerPairs(args: unknown, output: string) {
  const record = typeof args === "object" && args !== null ? args as Record<string, unknown> : {}
  const questions = Array.isArray(record.questions) ? record.questions : []
  let answers: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(output) as { answers?: unknown }
    if (typeof parsed.answers === "object" && parsed.answers !== null) answers = parsed.answers as Record<string, unknown>
  } catch { /* Failed or legacy ask_user results may not contain JSON. */ }
  return questions.flatMap((value) => {
    if (typeof value !== "object" || value === null) return []
    const question = value as Record<string, unknown>
    if (typeof question.question !== "string") return []
    const id = typeof question.id === "string" ? question.id : ""
    const header = typeof question.header === "string" && question.header ? `[${question.header}] ` : ""
    const answer = id && typeof answers[id] === "string" ? String(answers[id]) : undefined
    return [{ question: `${header}${question.question}`, ...(answer ? { answer } : {}) }]
  })
}

function interactionItems(args: unknown, output: string, language: DoCodeLanguage): NewTranscriptItem[] {
  return askAnswerPairs(args, output).flatMap((pair) => [
    { kind: "info", text: `${language === "zh" ? "提问" : "Ask"}: ${pair.question}` },
    ...(pair.answer ? [{ kind: "info" as const, text: `${language === "zh" ? "回答" : "Answer"}: ${pair.answer}` }] : []),
  ])
}

function restoredEventTranscript(events: unknown[], language: DoCodeLanguage) {
  const items: NewTranscriptItem[] = []
  const argsByCallId = new Map<string, unknown>()
  let pending: { turnId: string; groupKey: string; tools: TranscriptTool[] } | null = null
  let hasTurnHistory = false
  const flushTools = () => {
    if (pending?.tools.length) items.push({ kind: "tool", tools: pending.tools })
    pending = null
  }

  for (const record of events) {
    if (typeof record !== "object" || record === null || !("event" in record)) continue
    const raw = (record as { event?: unknown }).event
    if (typeof raw !== "object" || raw === null || !("type" in raw)) continue
    const event = raw as Record<string, unknown>
    const type = typeof event.type === "string" ? event.type : ""
    const turnId = typeof event.turnId === "string" ? event.turnId : ""

    if (type === "turn.started" && typeof event.input === "string") {
      flushTools()
      hasTurnHistory = true
      items.push({ kind: "user", text: event.input })
      continue
    }
    if (type === "tool.started" && typeof event.callId === "string") {
      argsByCallId.set(event.callId, event.args)
      continue
    }
    if (type === "tool.completed" && typeof event.callId === "string" && typeof event.name === "string") {
      const step = typeof event.step === "number" ? event.step : 0
      const groupKey = activityGroupKey(event.name, event.callId)
      if (pending && (pending.turnId !== turnId || pending.groupKey !== groupKey)) flushTools()
      const args = argsByCallId.get(event.callId)
      const output = typeof event.output === "string" ? event.output : "No stored tool result"
      const ok = event.ok === true
      if (event.name === "ask_user") {
        flushTools()
        items.push(...interactionItems(args, output, language))
        continue
      }
      if (event.name === "exit_plan_mode") {
        flushTools()
        const plan = planProposalFromArgs(args)
        if (plan) items.push({ kind: "plan", plan })
        continue
      }
      const tool: TranscriptTool = {
        callId: event.callId,
        step,
        name: event.name,
        args,
        ok,
        output,
        presentation: typeof event.presentation === "object" && event.presentation !== null
          ? event.presentation as ToolPresentation
          : createToolPresentation(event.name, args, { ok, output }, 0),
      }
      if ((event.name === "todo_write" || event.name === "todo_read") && ok && blockedTodoCount([tool]) === 0) {
        flushTools()
        items.push({ kind: "tool", tools: [tool], hidden: true })
        continue
      }
      const currentPending = pending as { turnId: string; groupKey: string; tools: TranscriptTool[] } | null
      pending = currentPending
        ? { ...currentPending, tools: [...currentPending.tools, tool] }
        : { turnId, groupKey, tools: [tool] }
      continue
    }
    if (type === "approval.resolved" && typeof event.name === "string") {
      const approved = event.approved === true
      if (!approved) {
        flushTools()
        items.push({ kind: "info", text: `Permission denied for ${event.name}.` })
      }
      continue
    }
    if (type === "turn.completed" && typeof event.output === "string") {
      flushTools()
      if (event.output.trim()) items.push({ kind: "assistant", text: event.output })
      continue
    }
    if (type === "turn.failed" && typeof event.message === "string") {
      flushTools()
      items.push({ kind: event.aborted === true || event.reason === "max_turns" ? "info" : "error", text: event.message })
    }
  }
  flushTools()
  return hasTurnHistory ? items : []
}

function restoredTranscript(messages: Message[], events: unknown[] = [], language: DoCodeLanguage = "en") {
  const eventTranscript = restoredEventTranscript(events, language)
  if (eventTranscript.length) return eventTranscript
  const items: NewTranscriptItem[] = []
  const results = new Map(messages
    .filter((message): message is Extract<Message, { role: "tool" }> => message.role === "tool")
    .map((message) => [message.tool_call_id, storedToolResult(message.content)]))
  const eventTools = historicalToolEvents(events)
  let fallbackStep = 0
  for (const message of messages) {
    if (message.role === "user") items.push({ kind: "user", text: contentText(message.content).split("\n\nReferenced file context:")[0]! })
    if (message.role !== "assistant") continue
    if (message.content?.trim()) items.push({ kind: "assistant", text: message.content })
    if (!message.tool_calls?.length) continue
    fallbackStep++
    const tools: TranscriptTool[] = []
    const hiddenTools: TranscriptTool[] = []
    for (const call of message.tool_calls) {
      const stored = results.get(call.id)
      const event = eventTools.get(call.id)
      const name = event?.name ?? call.function.name
      const args = event?.args ?? storedToolArgs(call.function.arguments)
      const output = event?.output ?? stored?.output ?? "No stored tool result"
      if (name === "ask_user") {
        items.push(...interactionItems(args, output, language))
        continue
      }
      if (name === "exit_plan_mode") {
        const plan = planProposalFromArgs(args)
        if (plan) items.push({ kind: "plan", plan })
        continue
      }
      const tool: TranscriptTool = {
        callId: call.id,
        step: event?.step ?? fallbackStep,
        name,
        args,
        ok: event?.ok ?? stored?.ok ?? false,
        output,
        presentation: event?.presentation ?? createToolPresentation(
          name,
          args,
          { ok: event?.ok ?? stored?.ok ?? false, output },
          0,
        ),
      }
      if ((name === "todo_write" || name === "todo_read") && tool.ok && blockedTodoCount([tool]) === 0) hiddenTools.push(tool)
      else tools.push(tool)
    }
    if (tools.length) items.push({ kind: "tool", tools })
    if (hiddenTools.length) items.push({ kind: "tool", tools: hiddenTools, hidden: true })
  }
  return items
}

function restoredSessionItems(title: string, messages: Message[], events: unknown[] = [], language: DoCodeLanguage = "en"): NewTranscriptItem[] {
  const transcript = restoredTranscript(messages, events, language)
  const conversationCount = transcript.filter((item) => item.kind === "user" || item.kind === "assistant").length
  const toolCount = transcript.filter((item) => item.kind === "tool").reduce((total, item) => total + item.tools.length, 0)
  return [
    { kind: "resume", title, visibleCount: conversationCount, conversationCount, toolCount },
    ...transcript,
  ]
}

export function ChatApp(props: ChatAppProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [terminalWidth, setTerminalWidth] = useState(() => stdout.columns || 80)
  const [terminalHeight, setTerminalHeight] = useState(() => stdout.rows || 24)
  const [items, setItems] = useState<TranscriptItem[]>(() => [
    { id: 0, kind: "header", workspace: props.workspace, model: props.model, sessionId: props.sessionId, restored: props.restored, ...(props.agent ? { agent: props.agent } : {}) },
    ...(props.restored ? restoredSessionItems(props.sessionTitle ?? props.sessionId, props.initialMessages, props.initialEvents, props.language ?? "en") : [])
      .map((item, index) => ({ ...item, id: index + 1 } as TranscriptItem)),
  ])
  const nextId = useRef(items.length)
  const [activeSessionId, setActiveSessionId] = useState(props.sessionId)
  const [activeSessionTitle, setActiveSessionTitle] = useState(props.sessionTitle ?? "")
  const [editor, renderEditor] = useState(() => createEditor())
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  const updateRunning = useCallback((value: boolean) => {
    runningRef.current = value
    setRunning(value)
  }, [])
  const [activeTool, setActiveTool] = useState<string | { name: string; args: unknown } | null>(null)
  const [activityEpoch, setActivityEpoch] = useState(0)
  const [reasoningCharacters, setReasoningCharacters] = useState(0)
  const [pendingToolGroup, setPendingToolGroup] = useState<PendingToolGroup | null>(null)
  const pendingToolGroupRef = useRef<PendingToolGroup | null>(null)
  const toolArgsRef = useRef(new Map<string, unknown>())
  const [liveAssistant, setLiveAssistant] = useState("")
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)
  const [approvalIndex, setApprovalIndex] = useState(0)
  const [question, setQuestion] = useState<UserQuestion | null>(null)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [questionDraft, setQuestionDraft] = useState("")
  const [planReview, setPlanReview] = useState<PlanReviewRequest | null>(null)
  const [planReviewIndex, setPlanReviewIndex] = useState(0)
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false)
  const [permissionMenuIndex, setPermissionMenuIndex] = useState(0)
  const permissionMenuIndexRef = useRef(0)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [historyDraft, setHistoryDraft] = useState("")
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])
  const [completionIndex, setCompletionIndex] = useState(0)
  const completionIndexRef = useRef(0)
  const [sessionPickerItems, setSessionPickerItems] = useState<SavedSession[] | null>(null)
  const [sessionPickerIndex, setSessionPickerIndex] = useState(0)
  const [sessionPickerQuery, setSessionPickerQuery] = useState("")
  const [memoryCount, setMemoryCount] = useState(0)
  const [trusted, setTrusted] = useState(false)
  const [contextPercent, setContextPercent] = useState(0)
  const [queuedInputs, setQueuedInputs] = useState<string[]>([])
  const [activeModel, setActiveModel] = useState(props.model)
  const [activeEffort, setActiveEffort] = useState<ReasoningEffort|"default">(props.reasoningEffort ?? "default")
  const [activeThinkingMode, setActiveThinkingMode] = useState<ThinkingMode>(props.thinkingMode ?? "auto")
  const [activeLanguage, setActiveLanguage] = useState<DoCodeLanguage>(props.language ?? "en")
  const [activeApprovalMode, setActiveApprovalMode] = useState<ApprovalMode>(props.approvalMode)
  const [activePlanMode, setActivePlanMode] = useState(Boolean(props.initialPlanMode))
  const [viewerItems, setViewerItems] = useState<TranscriptItem[] | null>(null)
  const [viewerOffset, setViewerOffset] = useState(Number.MAX_SAFE_INTEGER)
  const externalViewerActiveRef = useRef(false)
  const abortController = useRef<AbortController | null>(null)
  const editorRef = useRef(editor)
  const applyApprovalMode = useCallback((mode: ApprovalMode) => {
    if (props.setApprovalMode) props.setApprovalMode(mode)
    else props.policy?.setMode(mode)
    setActiveApprovalMode(mode)
  }, [props])
  const applyPlanMode = useCallback((active: boolean) => {
    props.setPlanMode?.(active)
    setActivePlanMode(active)
  }, [props])

  useEffect(() => {
    const updateSize = () => {
      setTerminalWidth(stdout.columns || 80)
      setTerminalHeight(stdout.rows || 24)
    }
    stdout.on("resize", updateSize)
    return () => { stdout.off("resize", updateSize) }
  }, [stdout])
  const setEditor = useCallback((update: EditorState | ((current: EditorState) => EditorState)) => {
    const next = typeof update === "function" ? update(editorRef.current) : update
    editorRef.current = next
    completionIndexRef.current = 0
    setCompletionIndex(0)
    renderEditor(next)
  }, [])
  const customCompletions=useMemo(()=>props.promptExtensions?.map((item)=>({label:`/${item.name}`,description:item.description,insert:`/${item.name}`}))??[],[props.promptExtensions])
  const argumentCompletions=useMemo<ArgumentCompletions>(()=>({
    "/model":(props.modelPresets??[]).map((preset)=>({label:preset,description:t(activeLanguage,preset===activeModel?"Current model":"Switch to this model"),insert:preset,submit:true})),
    "/effort":(["low","medium","high","xhigh","max"] as ReasoningEffort[]).map((effort)=>({label:effort,description:t(activeLanguage,effort===activeEffort?"Current reasoning effort":"Switch reasoning effort"),insert:effort,submit:true})),
    "/thinking":(["auto","on","off"] as ThinkingMode[]).map((mode)=>({label:mode,description:t(activeLanguage,mode===activeThinkingMode?"Current thinking mode":mode==="auto"?"Let the model decide when to think":mode==="on"?"Force thinking on":"Turn thinking off"),insert:mode,submit:true})),
    "/language":[
      {label:"zh",description:t(activeLanguage,"Set interface and output language to Chinese"),insert:"zh",submit:true},
      {label:"en",description:t(activeLanguage,"Set interface and output language to English"),insert:"en",submit:true},
    ],
    "/approval-mode":[
      ...(["ask", "auto", "full-access"] as ApprovalMode[]).map((mode) => ({
        label: mode,
        description: approvalModeNotice(mode, activeLanguage).split("\n").slice(1).join(" "),
        insert: mode,
        submit: true,
      })),
    ],
    "/memory":[
      {label:"list",description:t(activeLanguage,"List loaded AGENTS.md instruction files"),insert:"list",submit:true},
      {label:"show",description:t(activeLanguage,"Show loaded project instructions"),insert:"show",submit:true},
      {label:"reload",description:t(activeLanguage,"Reload instructions from disk"),insert:"reload",submit:true},
    ],
    "/rewind":[
      {label:"both",description:t(activeLanguage,"Rewind conversation and files"),insert:"both",submit:true},
      {label:"chat",description:t(activeLanguage,"Rewind conversation only"),insert:"chat",submit:true},
      {label:"files",description:t(activeLanguage,"Restore files only"),insert:"files",submit:true},
    ],
    "/export":[
      {label:"md",description:t(activeLanguage,"Export the session as Markdown"),insert:"md",submit:true},
      {label:"json",description:t(activeLanguage,"Export the session as JSON"),insert:"json",submit:true},
    ],
  }),[activeEffort,activeLanguage,activeModel,activeThinkingMode,props.modelPresets])
  const completion = useMemo(() => completionsForEditor(editor, workspaceFiles,customCompletions,argumentCompletions,activeLanguage), [activeLanguage,editor, workspaceFiles,customCompletions,argumentCompletions])
  const cursorParts = useMemo(() => editorCursorParts(editor), [editor])
  const completionItems = completion?.items ?? []
  const completionWindowStart = Math.max(0, Math.min(completionIndex - 4, completionItems.length - 6))
  const visibleCompletionItems = completionItems.slice(completionWindowStart, completionWindowStart + 6)
  const liveViewportRows = Math.max(4, Math.min(12, terminalHeight - 10))
  const liveAssistantViewport = useMemo(() => boundedLiveOutput(liveAssistant, terminalWidth - 6, liveViewportRows), [liveAssistant, liveViewportRows, terminalWidth])
  const viewerHeight = inlineViewerHeight(terminalWidth, terminalHeight)
  const viewerRows = Math.max(3, viewerHeight - 4)
  const viewerLineCount = useMemo(() => viewerItems ? wrapTerminalLines(transcriptViewerText(viewerItems, activeLanguage), Math.max(8, terminalWidth - 4)).length : 0, [activeLanguage, terminalWidth, viewerItems])
  const viewerMaximum = Math.max(0, viewerLineCount - viewerRows)
  const effectiveViewerOffset = Math.min(viewerMaximum, Math.max(0, viewerOffset))
  const visibleSessions = useMemo(() => {
    const query = sessionPickerQuery.trim().toLowerCase()
    return (sessionPickerItems ?? []).filter((session) => !query || [session.id, session.title, session.model]
      .some((value) => value?.toLowerCase().includes(query)))
  }, [sessionPickerItems, sessionPickerQuery])
  const sessionPickerWindowStart = Math.max(0, Math.min(sessionPickerIndex - 4, visibleSessions.length - 8))

  const append = useCallback((item: NewTranscriptItem) => {
    setItems((current) => [...current, { ...item, id: nextId.current++ } as TranscriptItem])
  }, [])
  const appendMany = useCallback((newItems: NewTranscriptItem[]) => {
    setItems((current) => [
      ...current,
      ...newItems.map((item) => ({ ...item, id: nextId.current++ } as TranscriptItem)),
    ])
  }, [])
  const flushPendingTools = useCallback(() => {
    const pending = pendingToolGroupRef.current
    if (!pending?.tools.length) return
    append({ kind: "tool", tools: pending.tools })
    pendingToolGroupRef.current = null
    setPendingToolGroup(null)
  }, [append])
  const addPendingTool = useCallback((tool: TranscriptTool) => {
    const groupKey = activityGroupKey(tool.name, tool.callId)
    const step = tool.step ?? 0
    const current = pendingToolGroupRef.current
    if (current && (current.groupKey !== groupKey || current.step !== step)) flushPendingTools()
    const pending = pendingToolGroupRef.current
    const next: PendingToolGroup = pending && pending.groupKey === groupKey && pending.step === step
      ? { groupKey, step, tools: [...pending.tools, tool] }
      : { groupKey, step, tools: [tool] }
    pendingToolGroupRef.current = next
    setPendingToolGroup(next)
  }, [flushPendingTools])
  const appendReportedError = useCallback((label: string, error: unknown, operation: string, context?: unknown) => {
    void props.reportError(error, operation, "exception", context).then((report) => {
      append({ kind: "error", text: `${label}: ${error instanceof Error ? error.message : String(error)}\nError ID: ${report.id}\nTo inspect it, run: do-code errors show ${report.id}` })
    }).catch(() => append({ kind: "error", text: `${label}: ${error instanceof Error ? error.message : String(error)} (failed to write the error report)` }))
  }, [append, props])

  useEffect(() => {
    props.approvalBridge.attach(setApproval)
    props.questionBridge?.attach((request) => {
      flushPendingTools()
      append({ kind: "info", text: `${activeLanguage === "zh" ? "提问" : "Ask"}: ${request.question}` })
      setQuestion(request)
    })
    props.planReviewBridge?.attach((request) => {
      flushPendingTools()
      append({ kind: "plan", plan: request.plan })
      setPlanReviewIndex(0)
      setPlanReview(request)
    })
    props.attachApprovalModeSink?.(setActiveApprovalMode)
    props.attachPlanModeSink?.(setActivePlanMode)
    props.attachEventSink((event) => {
      if (event.type === "turn.started") {
        flushPendingTools()
        setLiveAssistant("")
        setReasoningCharacters(0)
      } else if (event.type === "step.started") {
        // A step is the semantic batch boundary. Freeze the completed batch in
        // <Static> before the next animated activity begins, matching Gemini CLI.
        flushPendingTools()
        setActivityEpoch((current) => current + 1)
        setReasoningCharacters(0)
      } else if (event.type === "message.delta") {
        flushPendingTools()
        setLiveAssistant((current) => current + event.delta)
      } else if (event.type === "reasoning.delta") {
        setReasoningCharacters(event.totalCharacters)
      } else if (event.type === "tool.started") {
        setActivityEpoch((current) => current + 1)
        if (pendingToolGroupRef.current && pendingToolGroupRef.current.groupKey !== activityGroupKey(event.name, event.callId)) flushPendingTools()
        toolArgsRef.current.set(event.callId, event.args)
        setActiveTool(event.name === "todo_write" || event.name === "todo_read" ? null : { name: event.name, args: event.args })
        setLiveAssistant("")
        setReasoningCharacters(0)
      } else if (event.type === "tool.delta") {
        // Raw tool streams are intentionally hidden; the completed activity is summarized instead.
      } else if (event.type === "tool.completed") {
        setActiveTool(null)
        const args = toolArgsRef.current.get(event.callId)
        toolArgsRef.current.delete(event.callId)
        if (event.name === "ask_user" || event.name === "exit_plan_mode") return
        const tool: TranscriptTool = {
          callId: event.callId,
          step: event.step,
          name: event.name,
          ok: event.ok,
          output: event.output,
          ...(args === undefined ? {} : { args }),
          presentation: event.presentation ?? createToolPresentation(event.name, args, { ok: event.ok, output: event.output }, 0),
        }
        if ((event.name === "todo_write" || event.name === "todo_read") && event.ok && blockedTodoCount([tool]) === 0) {
          flushPendingTools()
          append({ kind: "tool", tools: [tool], hidden: true })
          return
        }
        addPendingTool(tool)
      } else if (event.type === "turn.completed" || event.type === "turn.failed") {
        flushPendingTools()
        setLiveAssistant("")
        setReasoningCharacters(0)
      }
    })
    return () => {
      props.approvalBridge.attach(null)
      props.questionBridge?.attach(null)
      props.planReviewBridge?.attach(null)
      props.attachApprovalModeSink?.(null)
      props.attachPlanModeSink?.(null)
      props.attachEventSink(null)
    }
  }, [activeLanguage, addPendingTool, append, flushPendingTools, props])

  useEffect(() => {
    void commandOutput("rg", [
      "--files", "--hidden",
      "--glob", "!.git/**",
      "--glob", "!.do-code/**",
      "--glob", "!node_modules/**",
      "--glob", "!dist/**",
      "--glob", "!build/**",
      "--glob", "!coverage/**",
    ], props.workspace)
      .then((output) => setWorkspaceFiles(output.split("\n").map((file) => file.trim()).filter(Boolean).slice(0, 5000)))
  }, [props.workspace])

  useEffect(() => {
    void props.conversation.memorySources().then((sources) => setMemoryCount(sources.length))
    void isWorkspaceTrusted(props.workspace).then(setTrusted)
  }, [props.conversation])

  useEffect(() => setSessionPickerIndex(0), [sessionPickerQuery])
  const finishApproval = useCallback((choice: ApprovalChoice) => {
    if (!approval) return
    approval.resolve(choice)
    if (choice === "deny") append({ kind: "info", text: `Permission denied for ${approval.tool}.` })
    setApproval(null)
    setApprovalIndex(0)
  }, [approval, append])

  const finishQuestion = useCallback((answer: string) => {
    if (!question) return
    question.resolve(answer)
    append({ kind: "info", text: `${activeLanguage === "zh" ? "回答" : "Answer"}: ${answer}` })
    setQuestion(null)
    setQuestionIndex(0)
    setQuestionDraft("")
  }, [activeLanguage, append, question])

  const finishPlanReview = useCallback((decision: PlanReviewDecision) => {
    if (!planReview) return
    planReview.resolve(decision)
    setPlanReview(null)
    setPlanReviewIndex(0)
  }, [planReview])

  const finishPermissionMenu = useCallback((mode?: ApprovalMode) => {
    if (mode) {
      applyApprovalMode(mode)
      append({ kind: "info", text: approvalModeNotice(mode, activeLanguage) })
    }
    setPermissionMenuOpen(false)
  }, [activeLanguage, append, applyApprovalMode])

  const resumeSelectedSession = useCallback((id: string) => {
    setSessionPickerItems(null)
    setSessionPickerQuery("")
    updateRunning(true)
    void (async () => {
      try {
        const loaded = await props.resumeSession(id)
        setActiveSessionId(loaded.session.id)
        setActiveSessionTitle(loaded.session.title ?? "")
        appendMany(restoredSessionItems(loaded.session.title ?? loaded.session.id, loaded.messages, loaded.events, activeLanguage))
      } catch (error) {
        appendReportedError("Resume failed", error, "session.resume", { id })
      } finally {
        updateRunning(false)
      }
    })()
  }, [appendMany, appendReportedError, props, updateRunning])

  const openSessionPicker = useCallback((query = "") => {
    void props.listSessions().then((sessions) => {
      if (!sessions.length) {
        append({ kind: "info", text: "This project has no resumable sessions." })
        return
      }
      setSessionPickerItems(sessions)
      setSessionPickerQuery(query)
      setSessionPickerIndex(0)
    }).catch((error) => appendReportedError("Failed to list sessions", error, "session.list"))
  }, [append, appendReportedError, props])

  const submit = useCallback((rawInput: string) => {
    const input = rawInput.trim()
    if (!input) return
    if (runningRef.current && !canRunSlashCommandDuringTask(input)) {
      setQueuedInputs((current) => enqueueMessage(current, input))
      setEditor(createEditor())
      setHistoryIndex(null)
      setHistoryDraft("")
      return
    }
    setEditor(createEditor())
    setHistory((current) => [...current.filter((value) => value !== input), input])
    setHistoryIndex(null)
    setHistoryDraft("")

    if (input === "/exit" || input === "/quit") {
      exit()
      return
    }
    if (input === "/help") {
      append({ kind: "info", text: activeLanguage === "zh"
        ? "/help 帮助 · /status 状态 · /stats 统计 · /compact 压缩上下文 · /diff 变更 · /clear 清空 · /exit 退出\n/model [provider/model] 查看或切换模型 · /auth 配置模型服务 · /thinking [auto|on|off] 切换思考模式 · /effort [low|medium|high|xhigh|max] 切换思考强度 · /language [zh|en] 切换语言 · /extensions 查看命令和 Skills\n/plan [目标|exit] 进入或退出规划 · /permissions 选择权限 · /approval-mode [mode] 切换审批模式 · /trust 信任工作区\n/bug [说明] 记录 Bad Case 并生成错误 ID\n/memory list|show|reload 管理分层 AGENTS.md\n/restore [id] 恢复文件 · /rewind [both|chat|files] 回退\n/resume [name] 恢复会话 · /rename <name> 重命名 · /export [md|json] [path] 导出\n@路径 添加工作区文件 · !命令 直接执行 Shell · Ctrl+T 查看全部消息 · Tab 接受补全 · Shift+Tab 切换 Plan · Alt+Enter 换行"
        : "/help Help · /status Status · /stats Statistics · /compact Compact · /diff Changes · /clear Clear · /exit Exit\n/model [provider/model] Show or switch models · /auth Configure model providers · /thinking [auto|on|off] Switch thinking mode · /effort [low|medium|high|xhigh|max] Switch reasoning effort · /language [zh|en] Switch language · /extensions Show commands and skills\n/plan [goal|exit] Enter or leave planning · /permissions Choose permissions · /approval-mode [mode] Switch approval mode · /trust Trust workspace\n/bug [description] Capture a bad case and create an error ID\n/memory list|show|reload Manage layered AGENTS.md files\n/restore [id] Restore files · /rewind [both|chat|files] Rewind\n/resume [name] Resume a session · /rename <name> Rename · /export [md|json] [path] Export\n@path Add workspace file context · !command Run shell directly · Ctrl+T View all messages · Tab Accept completion · Shift+Tab Toggle Plan · Alt+Enter New line" })
      return
    }
    if (input === "/language") {
      append({ kind: "info", text: `${t(activeLanguage,"Current language")}: ${languageDisplay(activeLanguage,activeLanguage)}\n${t(activeLanguage,"Available languages")}: 中文 [zh-CN], English [en-US]\n${activeLanguage === "zh" ? "用法" : "Usage"}: /language [zh|en]` })
      return
    }
    if (input.startsWith("/language ")) {
      const requested=normalizeLanguage(input.slice("/language ".length))
      if(!requested){append({kind:"error",text:t(activeLanguage,"Invalid language. Usage: /language [en|zh]")});return}
      void (props.setLanguage?.(requested)??Promise.resolve()).then(()=>{
        setActiveLanguage(requested)
        append({kind:"info",text:t(requested,requested==="zh"?"Language changed to Chinese.":"Language changed to English.")})
      }).catch((error)=>appendReportedError(t(activeLanguage,"Language setting failed"),error,"language.switch",{requested}))
      return
    }
    if (input === "/model") {
      append({ kind: "info", text: `Current model: ${activeModel}\nAvailable presets:\n${(props.modelPresets??[]).map((preset) => `  ${preset === activeModel ? "●" : "○"} ${preset}`).join("\n") || "  none"}\nUsage: /model provider/model` })
      return
    }
    if (input === "/auth") {
      append({kind:"info",text:activeLanguage==="zh"?"为避免 API Key 出现在聊天记录中，请退出当前会话后运行 do-code auth；配置完成后重新进入即可。":"To keep API keys out of chat history, exit this session and run do-code auth, then start do-code again."})
      return
    }
    if (input.startsWith("/model ")) {
      const preset=input.slice("/model ".length).trim()
      updateRunning(true);setActiveTool("Switching model")
      if(!props.switchModel){append({kind:"error",text:"This client does not support model switching."});updateRunning(false);setActiveTool(null);return}
      void props.switchModel(preset).then((config)=>{setActiveModel(config.preset)})
        .catch((error)=>appendReportedError("Model switch failed",error,"model.switch",{preset}))
        .finally(()=>{updateRunning(false);setActiveTool(null)})
      return
    }
    if (input === "/effort") {
      append({kind:"info",text:`Reasoning effort: ${activeEffort}\nAvailable: low, medium, high, xhigh, max\nUsage: /effort <level>`})
      return
    }
    if (input.startsWith("/effort ")) {
      const effort=input.slice("/effort ".length).trim() as ReasoningEffort
      if(!["low","medium","high","xhigh","max"].includes(effort)){append({kind:"error",text:"Usage: /effort low|medium|high|xhigh|max"});return}
      if(!props.switchEffort){append({kind:"error",text:"This client does not support reasoning effort switching."});return}
      void props.switchEffort(effort).then((config)=>{const requested=config.reasoningEffort??effort;setActiveEffort(requested);append({kind:"info",text:`Reasoning effort: ${requested}${config.effectiveReasoningEffort&&config.effectiveReasoningEffort!==requested?` (effective: ${config.effectiveReasoningEffort})`:""}`})}).catch((error)=>appendReportedError("Effort switch failed",error,"effort.switch",{effort}))
      return
    }
    if (input === "/thinking") {
      append({kind:"info",text:activeLanguage==="zh"?`思考模式：${activeThinkingMode}\n可选：auto（自动）、on（开启）、off（关闭）\n用法：/thinking <mode>`:`Thinking mode: ${activeThinkingMode}\nAvailable: auto, on, off\nUsage: /thinking <mode>`})
      return
    }
    if (input.startsWith("/thinking ")) {
      const mode=input.slice("/thinking ".length).trim() as ThinkingMode
      if(!["auto","on","off"].includes(mode)){append({kind:"error",text:activeLanguage==="zh"?"用法：/thinking auto|on|off":"Usage: /thinking auto|on|off"});return}
      if(!props.switchThinking){append({kind:"error",text:activeLanguage==="zh"?"当前客户端不支持切换思考模式。":"This client does not support thinking mode switching."});return}
      void props.switchThinking(mode).then((config)=>{const requested=config.thinkingMode??mode;const effective=config.effectiveThinkingMode??requested;setActiveThinkingMode(requested);append({kind:"info",text:activeLanguage==="zh"?`思考模式：${requested}${effective!==requested?`（实际：${effective}）`:""}`:`Thinking mode: ${requested}${effective!==requested?` (effective: ${effective})`:""}`})}).catch((error)=>appendReportedError(activeLanguage==="zh"?"思考模式切换失败":"Thinking mode switch failed",error,"thinking.switch",{mode}))
      return
    }
    if (input === "/extensions") {
      append({kind:"info",text:props.promptExtensions?.length?props.promptExtensions.map((item)=>`/${item.name}  [${item.kind} · ${item.source}] ${item.description}`).join("\n"):"No custom commands or skills are loaded."})
      return
    }
    if (input === "/bug" || input.startsWith("/bug ")) {
      const description = input.slice("/bug".length).trim() || "User captured the current bad case"
      updateRunning(true)
      setActiveTool("Collecting diagnostics")
      void props.reportError(new Error(description), "interactive.bad_case", "bad_case", { description }).then((report) => {
        append({ kind: "info", text: `Bad case saved.\nError ID: ${report.id}\nLog: ${report.file}\nSend me this ID when you want to investigate it.` })
      }).catch((error) => append({ kind: "error", text: `Failed to save bad case: ${error instanceof Error ? error.message : String(error)}` }))
        .finally(() => { updateRunning(false); setActiveTool(null) })
      return
    }
    if (input === "/status") {
      void props.conversation.memorySources().then((sources) => {
        setMemoryCount(sources.length)
      append({ kind: "info", text: `Workspace: ${props.workspace}\nModel: ${activeModel}\nThinking mode: ${activeThinkingMode}\nReasoning effort: ${activeEffort}\nSession: ${activeSessionId}${activeSessionTitle ? ` · ${activeSessionTitle}` : ""}\nPlan mode: ${activePlanMode ? "on" : "off"}\nApproval mode: ${activeApprovalMode}\nTrusted workspace: ${trusted ? "yes" : "no"}\nContext messages: ${props.conversation.history().length}\nProject instructions: ${sources.length} source(s)` })
      }).catch((error) => appendReportedError("Failed to read status", error, "status.read"))
      return
    }
    if (input === "/permissions") {
      const modes: ApprovalMode[] = ["ask", "auto", "full-access"]
      const currentIndex = Math.max(0, modes.indexOf(activeApprovalMode))
      permissionMenuIndexRef.current = currentIndex
      setPermissionMenuIndex(currentIndex)
      setPermissionMenuOpen(true)
      return
    }
    if (input === "/plan" || input.startsWith("/plan ")) {
      const goal = input.slice("/plan".length).trim()
      if (goal === "exit") {
        applyPlanMode(false)
      } else {
        applyPlanMode(true)
        if (goal) setQueuedInputs((current) => enqueueMessage(current, goal))
      }
      return
    }
    if (input === "/approval-mode" || input.startsWith("/approval-mode ")) {
      const requested = input.slice("/approval-mode".length).trim()
      if (!requested) append({ kind: "info", text: (["ask", "auto", "full-access"] as ApprovalMode[]).map((mode) => approvalModeNotice(mode, activeLanguage)).join("\n\n") })
      else if (!["ask", "auto", "full-access"].includes(requested)) append({ kind: "error", text: activeLanguage === "zh" ? "用法：/approval-mode [ask|auto|full-access]；计划模式请使用 /plan。" : "Usage: /approval-mode [ask|auto|full-access]; use /plan for planning." })
      else {
        applyApprovalMode(requested as ApprovalMode)
        append({ kind: "info", text: approvalModeNotice(requested as ApprovalMode, activeLanguage) })
      }
      return
    }
    if (input === "/trust" || input === "/untrust") {
      const next = input === "/trust"
      void setWorkspaceTrusted(props.workspace, next).then(() => {
        setTrusted(next)
        append({ kind: "info", text: next ? "The current directory is now trusted." : "Workspace trust has been removed." })
      }).catch((error) => appendReportedError("Failed to update workspace trust", error, "workspace.trust"))
      return
    }
    if (input === "/restore" || input.startsWith("/restore ")) {
      const id = input.slice("/restore".length).trim() || undefined
      void props.conversation.restoreCheckpoint(id).then((checkpoint) => append({ kind: "info", text: `Restored file checkpoint ${checkpoint.id}: ${checkpoint.path}` }))
        .catch((error) => appendReportedError("Restore failed", error, "checkpoint.restore", { id }))
      return
    }
    if (input === "/stats") {
      const stats = props.conversation.stats()
      setContextPercent(Math.round(stats.currentContextTokens / stats.contextWindow * 100))
      append({ kind: "info", text: `Model requests: ${stats.requests}\nInput tokens: ${stats.inputTokens}\nOutput tokens: ${stats.outputTokens}\nCached tokens: ${stats.cachedTokens}\nTool calls: ${stats.toolCalls}\nContext compactions: ${stats.compactions}\nCurrent context: about ${stats.currentContextTokens} / ${stats.contextWindow} tokens (${Math.round(stats.currentContextTokens / stats.contextWindow * 100)}%)` })
      return
    }
    if (input === "/compact") {
      updateRunning(true)
      setActiveTool("Compacting context")
      void props.conversation.compact().then((compacted) => {
        const stats = props.conversation.stats()
        setContextPercent(Math.round(stats.currentContextTokens / stats.contextWindow * 100))
        append({ kind: "info", text: compacted ? `Context compacted to about ${stats.currentContextTokens} tokens.` : "The current context does not need compaction." })
      }).catch((error) => appendReportedError("Compaction failed", error, "context.compact"))
        .finally(() => { updateRunning(false); setActiveTool(null) })
      return
    }
    if (input === "/rewind" || input.startsWith("/rewind ")) {
      const requested = input.slice("/rewind".length).trim() || "both"
      if (requested !== "both" && requested !== "chat" && requested !== "files") append({ kind: "error", text: "Usage: /rewind [both|chat|files]" })
      else void props.conversation.rewind(requested).then((checkpoint) => append({ kind: "info", text: `Rewound to ${checkpoint.id} (${requested}): ${checkpoint.path}` }))
        .catch((error) => appendReportedError("Rewind failed", error, "checkpoint.rewind", { requested }))
      return
    }
    if (input === "/memory" || input === "/memory list" || input.startsWith("/memory show") || input === "/memory reload") {
      updateRunning(true)
      setActiveTool("Project instructions")
      void (async () => {
        try {
          const sources = input === "/memory reload"
            ? await props.conversation.reloadMemory()
            : await props.conversation.memorySources()
          setMemoryCount(sources.length)
          if (input === "/memory reload") {
            append({ kind: "info", text: `Project instructions reloaded from ${sources.length} source(s).` })
          } else if (input.startsWith("/memory show")) {
            const query = input.slice("/memory show".length).trim()
            const selected = query
              ? sources.filter((source, index) => String(index + 1) === query || source.path.includes(query))
              : sources
            append({ kind: "info", text: selected.length
              ? selected.map((source) => `# ${source.label}\n${source.path}\n\n${source.content}`).join("\n\n---\n\n")
              : `Instruction source not found: ${query || "current project"}` })
          } else {
            append({ kind: "info", text: sources.length
              ? `Using ${sources.length} AGENTS.md file(s):\n${sources.map((source, index) => `${index + 1}. [${source.scope}] ${source.path}`).join("\n")}`
              : "No AGENTS.md files are loaded." })
          }
        } catch (error) {
          appendReportedError("Project instruction operation failed", error, "memory.command", { input })
        } finally {
          updateRunning(false)
          setActiveTool(null)
        }
      })()
      return
    }
    if (input === "/resume") {
      openSessionPicker()
      return
    }
    if (input.startsWith("/resume ")) {
      const query = input.slice("/resume ".length).trim()
      void props.listSessions().then((sessions) => {
        const exact = sessions.find((session) => session.id === query)
        const matches = exact ? [exact] : sessions.filter((session) => session.title?.toLowerCase().includes(query.toLowerCase()))
        if (matches.length === 1) resumeSelectedSession(matches[0]!.id)
        else if (matches.length > 1) {
          setSessionPickerItems(matches)
          setSessionPickerQuery("")
          setSessionPickerIndex(0)
        } else append({ kind: "error", text: `Session not found: ${query}` })
      }).catch((error) => appendReportedError("Failed to search sessions", error, "session.search", { query }))
      return
    }
    if (input.startsWith("/rename")) {
      const title = input.slice("/rename".length).trim()
      if (!title) append({ kind: "error", text: "Usage: /rename <new-name>" })
      else {
        updateRunning(true)
        setActiveTool("Renaming session")
        void props.renameCurrentSession(title).then((session) => {
          setActiveSessionTitle(session.title ?? "")
          append({ kind: "info", text: `Session renamed to: ${session.title}` })
        }).catch((error) => appendReportedError("Rename failed", error, "session.rename", { title }))
          .finally(() => { updateRunning(false); setActiveTool(null) })
      }
      return
    }
    if (input.startsWith("/export")) {
      const parts = input.slice("/export".length).trim().split(/\s+/).filter(Boolean)
      const format = parts[0] ?? "md"
      if (format !== "md" && format !== "json") append({ kind: "error", text: "Usage: /export [md|json] [output-path]" })
      else {
        updateRunning(true)
        setActiveTool("Exporting session")
        void props.exportCurrentSession(format, parts[1]).then((file) => append({ kind: "info", text: `Session exported: ${file}` }))
          .catch((error) => appendReportedError("Export failed", error, "session.export", { format, output: parts[1] }))
          .finally(() => { updateRunning(false); setActiveTool(null) })
      }
      return
    }

    const extensionName=input.startsWith("/")?input.slice(1).split(/\s+/,1)[0]:undefined
    const extension=extensionName?props.promptExtensions?.find((item)=>item.name===extensionName):undefined
    const effectiveInput=extension?expandPromptExtension(extension,input.slice(extensionName!.length+1).trim()):input
    flushPendingTools()
    append({ kind: "user", text: input })
    updateRunning(true)
    const controller = new AbortController()
    abortController.current = controller
    void (async () => {
      try {
        if (input.startsWith("!")) {
          const command = input.slice(1).trim()
          if (!command) {
            append({ kind: "info", text: "Usage: !<shell-command>, for example !npm test" })
          } else {
            setActiveTool("shell")
            const result = await props.runShellShortcut(command)
            append({ kind: "tool", tools: [{ name: "shell", args: { command }, ok: result.ok, output: result.output, presentation: result.presentation ?? createToolPresentation("shell", { command }, result, 0) }] })
          }
        } else if (input === "/diff") {
          append({ kind: "info", text: (await commandOutput("git", ["diff", "--no-ext-diff", "--", "."], props.workspace)) || "There are no Git changes." })
        } else if (input === "/clear") {
          await props.conversation.clear()
          append({ kind: "info", text: "Conversation context cleared. File changes were preserved." })
        } else {
          const answer = await props.conversation.run(effectiveInput, { signal: controller.signal })
          append({ kind: "assistant", text: answer })
          const stats = props.conversation.stats()
          setContextPercent(Math.round(stats.currentContextTokens / stats.contextWindow * 100))
        }
        await props.save()
      } catch (error) {
        if (controller.signal.aborted) append({ kind: "info", text: "The current task was interrupted." })
        else if (error instanceof MaxSessionTurnsError) append({
          kind: "info",
          text: activeLanguage === "zh"
            ? `本次任务已达到最大模型轮次 ${error.maxTurns}。可使用 --max-steps 或 Agent 配置提高限制。`
            : `This task reached the maximum of ${error.maxTurns} model turns. Increase it with --max-steps or the active agent profile.`,
        })
        else appendReportedError("Turn failed", error, "agent.turn", { input })
      } finally {
        updateRunning(false)
        setActiveTool(null)
        setLiveAssistant("")
        abortController.current = null
      }
    })()
  }, [activeApprovalMode, activeLanguage, activePlanMode, append, appendReportedError, applyApprovalMode, applyPlanMode, exit, flushPendingTools, props, updateRunning])

  useEffect(() => {
    if (running || approval || question || planReview || permissionMenuOpen || sessionPickerItems || !queuedInputs.length) return
    const next = takeNextMessage(queuedInputs)
    setQueuedInputs(next.queue)
    if (next.message) queueMicrotask(() => submit(next.message!))
  }, [approval, permissionMenuOpen, planReview, question, queuedInputs, running, sessionPickerItems, submit])

  useInput((rawInput, key) => {
    const extendedKey=key as typeof key & {super?:boolean;home?:boolean;end?:boolean}
    const input = rawInput.replaceAll("\u001b[200~", "").replaceAll("\u001b[201~", "")
    const isShiftTab = (key.tab && key.shift) || rawInput === "\u001b[Z"
    const isViewerToggle = key.ctrl && (input.toLowerCase() === "t" || rawInput === "\u0014")
    // A dedicated alternate-buffer renderer owns stdin while the message
    // viewer is open. Keep the main React tree mounted, but do not let the
    // same keystrokes mutate its editor or command state.
    if (externalViewerActiveRef.current) {
      props.forwardTranscriptViewerInput?.(rawInput, {
        ctrl: key.ctrl,
        escape: key.escape,
        upArrow: key.upArrow,
        downArrow: key.downArrow,
        pageUp: key.pageUp,
        pageDown: key.pageDown,
        home: Boolean(extendedKey.home),
        end: Boolean(extendedKey.end),
      })
      return
    }
    if (viewerItems) {
      if (isViewerToggle || key.escape) { setViewerItems(null); setViewerOffset(Number.MAX_SAFE_INTEGER); return }
      if (key.upArrow) { setViewerOffset(Math.max(0,effectiveViewerOffset-1)); return }
      if (key.downArrow) { setViewerOffset(Math.min(viewerMaximum,effectiveViewerOffset+1)); return }
      if (key.pageUp) { setViewerOffset(Math.max(0,effectiveViewerOffset-viewerRows)); return }
      if (key.pageDown) { setViewerOffset(Math.min(viewerMaximum,effectiveViewerOffset+viewerRows)); return }
      if (extendedKey.home) { setViewerOffset(0); return }
      if (extendedKey.end) { setViewerOffset(viewerMaximum); return }
      return
    }
    if (isViewerToggle && !approval && !question && !planReview && !permissionMenuOpen && !sessionPickerItems) {
      if (props.openTranscriptViewer) {
        externalViewerActiveRef.current = true
        void props.openTranscriptViewer([...items], activeLanguage).finally(() => {
          externalViewerActiveRef.current = false
        })
        return
      }
      // Freeze committed history only. In-flight tool/assistant output remains outside
      // <Static>, so closing the viewer cannot commit a temporary duplicate line.
      setViewerItems([...items])
      setViewerOffset(Number.MAX_SAFE_INTEGER)
      return
    }
    if (isShiftTab) {
      const next = !activePlanMode
      applyPlanMode(next)
      return
    }
    if (approval) {
      const choices: ApprovalChoice[] = ["once", "session", "always", "deny"]
      if (key.upArrow) setApprovalIndex((current) => Math.max(0, current - 1))
      else if (key.downArrow) setApprovalIndex((current) => Math.min(choices.length - 1, current + 1))
      else if (key.return) finishApproval(choices[approvalIndex]!)
      else if (/^[1-4]$/.test(input)) finishApproval(choices[Number(input) - 1]!)
      else if (input.toLowerCase() === "y") finishApproval("once")
      else if (input.toLowerCase() === "n" || key.escape) finishApproval("deny")
      return
    }
    if (planReview) {
      const decisions: PlanReviewDecision[] = ["execute", "revise", "cancel"]
      if (key.upArrow) setPlanReviewIndex((current) => Math.max(0, current - 1))
      else if (key.downArrow) setPlanReviewIndex((current) => Math.min(decisions.length - 1, current + 1))
      else if (key.return) finishPlanReview(decisions[planReviewIndex]!)
      else if (/^[1-3]$/.test(input)) finishPlanReview(decisions[Number(input) - 1]!)
      else if (key.escape) finishPlanReview("cancel")
      return
    }
    if (permissionMenuOpen) {
      const modes: ApprovalMode[] = ["ask", "auto", "full-access"]
      const updatePermissionIndex = (next: number) => {
        permissionMenuIndexRef.current = next
        setPermissionMenuIndex(next)
      }
      if (key.upArrow) updatePermissionIndex(Math.max(0, permissionMenuIndexRef.current - 1))
      else if (key.downArrow) updatePermissionIndex(Math.min(modes.length - 1, permissionMenuIndexRef.current + 1))
      else if (key.return) finishPermissionMenu(modes[permissionMenuIndexRef.current]!)
      else if (/^[1-3]$/.test(input)) finishPermissionMenu(modes[Number(input) - 1]!)
      else if (key.escape) finishPermissionMenu()
      return
    }
    if (question) {
      if (key.escape) finishQuestion("User cancelled the question")
      else if (question.options.length && key.upArrow) setQuestionIndex((current) => Math.max(0, current - 1))
      else if (question.options.length && key.downArrow) setQuestionIndex((current) => Math.min(question.options.length - 1, current + 1))
      else if (key.return) {
        const answer = question.options.length ? question.options[questionIndex] : questionDraft.trim()
        if (answer) finishQuestion(answer!)
      } else if (!question.options.length && (key.backspace || key.delete)) setQuestionDraft((current) => Array.from(current).slice(0, -1).join(""))
      else if (!question.options.length && !key.ctrl && !key.meta && !extendedKey.super && input) setQuestionDraft((current) => current + input)
      return
    }
    if (sessionPickerItems) {
      if (key.escape || (key.ctrl && input === "c")) {
        setSessionPickerItems(null)
        setSessionPickerQuery("")
        return
      }
      if (key.upArrow) {
        setSessionPickerIndex((current) => Math.max(0, current - 1))
        return
      }
      if (key.downArrow) {
        setSessionPickerIndex((current) => Math.min(Math.max(0, visibleSessions.length - 1), current + 1))
        return
      }
      if (key.return) {
        const selected = visibleSessions[sessionPickerIndex]
        if (selected) resumeSelectedSession(selected.id)
        return
      }
      if (key.backspace || key.delete) {
        setSessionPickerQuery((current) => Array.from(current).slice(0, -1).join(""))
        return
      }
      if (!key.ctrl && !key.meta && !extendedKey.super && input) setSessionPickerQuery((current) => current + input)
      return
    }
    if (running) {
      if (key.escape || (key.ctrl && input === "c")) {
        abortController.current?.abort()
        return
      }
    }
    if (key.ctrl && input === "c") {
      if (editorRef.current.value) setEditor(createEditor())
      else exit()
      return
    }
    if (key.ctrl && input === "d") {
      if (!editorRef.current.value) exit()
      else setEditor((current) => deleteEditor(current))
      return
    }
    if ((key.ctrl && input === "j") || (key.meta && key.return)) {
      setEditor((current) => insertEditorText(current, "\n"))
      return
    }
    if (!key.ctrl && !key.meta && input.includes("\t")) {
      const tabIndex = input.indexOf("\t")
      let next = insertEditorText(editorRef.current, input.slice(0, tabIndex))
      next = applyCompletion(next, workspaceFiles, completionIndexRef.current,customCompletions,argumentCompletions,activeLanguage)
      const remainder = input.slice(tabIndex + 1)
      const shouldSubmit = /(?:\r\n|\r|\n)$/.test(remainder)
      const tail = shouldSubmit ? remainder.replace(/(?:\r\n|\r|\n)$/, "") : remainder
      next = insertEditorText(next, tail)
      setEditor(next)
      if (shouldSubmit) submit(next.value)
      return
    }
    const isPlainReturn = !key.ctrl && !key.meta && (key.return || /^(?:\r\n|\r|\n)$/.test(input))
    const currentCompletionItems = completionsForEditor(editorRef.current, workspaceFiles, customCompletions, argumentCompletions,activeLanguage)?.items ?? []
    if (isPlainReturn && currentCompletionItems.length) {
      const index = completionIndexRef.current
      const selected = currentCompletionItems[((index % currentCompletionItems.length) + currentCompletionItems.length) % currentCompletionItems.length]
      if (selected && editorRef.current.value === selected.insert) {
        submit(editorRef.current.value)
        return
      }
      const completed = applyCompletion(editorRef.current, workspaceFiles, index, customCompletions, argumentCompletions,activeLanguage)
      if (selected?.submit) submit(completed.value)
      else setEditor(completed)
      return
    }
    const newlineMatches = input.match(/\r\n|\r|\n/g)
    if (!key.ctrl && !key.meta && newlineMatches?.length === 1 && /(?:\r\n|\r|\n)$/.test(input)) {
      submit(insertEditorText(editorRef.current, input.replace(/(?:\r\n|\r|\n)$/, "")).value)
      return
    }
    if (key.return) {
      submit(editorRef.current.value)
      return
    }
    if (key.tab && currentCompletionItems.length) {
      setEditor((current) => applyCompletion(current, workspaceFiles, completionIndexRef.current,customCompletions,argumentCompletions,activeLanguage))
      return
    }
    if (key.leftArrow) {
      setEditor((current) => moveEditorCursor(current, -1))
      return
    }
    if (key.rightArrow) {
      setEditor((current) => moveEditorCursor(current, 1))
      return
    }
    if (extendedKey.home || (key.ctrl && input === "a")) {
      setEditor((current) => moveEditorHome(current))
      return
    }
    if (extendedKey.end || (key.ctrl && input === "e")) {
      setEditor((current) => moveEditorEnd(current))
      return
    }
    if (key.backspace || key.delete) {
      setEditor((current) => backspaceEditor(current))
      return
    }
    if (key.ctrl && input === "u") {
      setEditor(createEditor())
      return
    }
    if ((key.ctrl || key.meta || extendedKey.super) && input.toLowerCase() === "z") {
      setEditor((current) => key.shift ? redoEditor(current) : undoEditor(current))
      return
    }
    if (key.ctrl && input.toLowerCase() === "y") {
      setEditor((current) => redoEditor(current))
      return
    }
    if (currentCompletionItems.length && key.upArrow) {
      const next = (completionIndexRef.current - 1 + currentCompletionItems.length) % currentCompletionItems.length
      completionIndexRef.current = next
      setCompletionIndex(next)
      return
    }
    if (key.upArrow && !editorRef.current.value && queuedInputs.length) {
      const editable = takeLastMessage(queuedInputs)
      setQueuedInputs(editable.queue)
      if (editable.message) setEditor(createEditor(editable.message))
      return
    }
    if (currentCompletionItems.length && key.downArrow) {
      const next = (completionIndexRef.current + 1) % currentCompletionItems.length
      completionIndexRef.current = next
      setCompletionIndex(next)
      return
    }
    if (key.upArrow && editorRef.current.value.includes("\n")) {
      const moved = moveEditorVertical(editorRef.current, -1)
      if (moved.cursor !== editorRef.current.cursor) {
        setEditor(moved)
        return
      }
    }
    if (key.downArrow && editorRef.current.value.includes("\n")) {
      const moved = moveEditorVertical(editorRef.current, 1)
      if (moved.cursor !== editorRef.current.cursor) {
        setEditor(moved)
        return
      }
    }
    if (key.upArrow && history.length) {
      const index = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1)
      if (historyIndex === null) setHistoryDraft(editorRef.current.value)
      setHistoryIndex(index)
      setEditor(createEditor(history[index] ?? ""))
      return
    }
    if (key.downArrow && historyIndex !== null) {
      const index = historyIndex + 1
      if (index >= history.length) {
        setHistoryIndex(null)
        setEditor(createEditor(historyDraft))
      } else {
        setHistoryIndex(index)
        setEditor(createEditor(history[index] ?? ""))
      }
      return
    }
    if (!key.ctrl && !key.meta && !extendedKey.super && input) {
      setEditor((current) => insertEditorText(current, input))
    }
  })

  const pendingHistoryContent = viewerItems ? null : (
    <>
      {pendingToolGroup?.tools.length ? (
        <PendingToolSummary
          tools={pendingToolGroup.tools}
          width={terminalWidth}
          language={activeLanguage}
        />
      ) : null}
      {running && !approval && !question && !planReview && !permissionMenuOpen && !sessionPickerItems ? (
        <Box flexDirection="column">
          {liveAssistant ? (
            <MessageContinuation>
              {liveAssistantViewport.truncated ? <Text dimColor>… {t(activeLanguage, "Showing the latest streaming output; the complete answer will appear when finished")}</Text> : null}
              <Text wrap="wrap">{liveAssistantViewport.text}</Text>
            </MessageContinuation>
          ) : null}
          <Spinner
            key={`activity-${activityEpoch}`}
            label={activeTool
              ? typeof activeTool === "string" ? activeTool : activeToolSummary(activeTool.name, activeTool.args, activeLanguage)
              : reasoningCharacters > 0
                ? activeLanguage === "zh" ? `思考中 · 已接收 ${reasoningCharacters.toLocaleString()} 字符` : `Thinking · ${reasoningCharacters.toLocaleString()} reasoning characters received`
                : t(activeLanguage,"Thinking")}
            language={activeLanguage}
          />
        </Box>
      ) : null}
    </>
  )

  return (
    <DefaultAppLayout
      width={terminalWidth}
      main={<>
        <Static items={viewerItems ?? items}>{(item, index) => {
          const staticItems=viewerItems??items
          const nextKind = staticItems[index + 1]?.kind
          return <TranscriptLine key={item.id} item={item} width={terminalWidth} language={activeLanguage} {...(nextKind ? { nextKind } : {})} />
        }}</Static>
        {pendingHistoryContent}
      </>}
      controls={<Box flexDirection="column">
      {viewerItems ? <TranscriptViewer items={viewerItems} offset={effectiveViewerOffset} width={terminalWidth} height={viewerHeight} language={activeLanguage}/> : null}
      {!viewerItems ? <>
      {approval ? (
        <ApprovalDialog request={approval} selectedIndex={approvalIndex} language={activeLanguage} width={terminalWidth} />
      ) : null}
      {question ? (
        <QuestionDialog
          question={question.question}
          options={question.options}
          selectedIndex={questionIndex}
          draft={questionDraft}
          language={activeLanguage}
        />
      ) : null}
      {planReview ? <PlanReviewDialog plan={planReview.plan} selectedIndex={planReviewIndex} language={activeLanguage} width={terminalWidth} /> : null}
      {permissionMenuOpen ? <PermissionModeDialog currentMode={activeApprovalMode} selectedIndex={permissionMenuIndex} language={activeLanguage} /> : null}
      {!approval && !question && !planReview && !permissionMenuOpen && !sessionPickerItems ? <QueuedMessages messages={queuedInputs} /> : null}
      {sessionPickerItems && !running && !approval ? (
        <DialogManager><DialogSurface>
          <Text bold>Resume a previous session</Text>
          <Text dimColor>Search: {sessionPickerQuery || "type a title or ID"}  ↑↓ Select · Enter Resume · Esc Cancel</Text>
          {visibleSessions.length ? visibleSessions.slice(sessionPickerWindowStart, sessionPickerWindowStart + 8).map((session, windowIndex) => {
            const index = sessionPickerWindowStart + windowIndex
            return <Text key={session.id} inverse={index === sessionPickerIndex} color={session.id === activeSessionId ? tuiTheme.success : index === sessionPickerIndex ? tuiTheme.accent : tuiTheme.border}>
              {index === sessionPickerIndex ? "›" : " "} {session.title ?? session.id}  <Text dimColor>{session.id} · {session.updatedAt}</Text>
            </Text>
          }) : <Text dimColor>No matching sessions</Text>}
        </DialogSurface></DialogManager>
      ) : null}
      </> : null}
      {!approval && !question && !planReview && !permissionMenuOpen && !sessionPickerItems ? (
        <Composer
          key="composer"
          running={running}
          input={
            viewerItems ? <Text>
              <Text bold color={tuiTheme.accent}>› </Text>
              <Text dimColor>{activeLanguage === "zh" ? "正在查看消息；按 Ctrl+T 或 Esc 返回输入" : "Viewing messages; press Ctrl+T or Esc to return to input"}</Text>
            </Text> : <Text>
              <Text bold color={tuiTheme.accent}>› </Text>
              {cursorParts.before}
              <Text inverse>{cursorParts.cursor}</Text>
              {cursorParts.after}
              {!editor.value ? <Text dimColor> {t(activeLanguage,running ? "Current task is running; press Enter to queue a message" : "Enter a task or @file path")}</Text> : null}
            </Text>
          }
          suggestions={viewerItems ? undefined : <>{visibleCompletionItems.map((item, windowIndex) => {
            const index = completionWindowStart + windowIndex
            return <Text key={item.label} inverse={index === completionIndex} color={index === completionIndex ? tuiTheme.accent : tuiTheme.border}>
              {index === completionIndex ? "›" : " "} {item.label}  <Text dimColor>{item.description}</Text>
            </Text>
          })}</>}
          status={<>{composerStatusText({
            language: activeLanguage,
            running,
            command: editor.value.trimStart().startsWith("/"),
            width: terminalWidth,
            model: activeModel,
            reasoningIntensity: activeEffort,
            thinkingMode: activeThinkingMode,
            contextPercent,
            approvalMode: activeApprovalMode,
            planMode: activePlanMode,
          })}{props.renderRevision ? props.renderRevision % 2 ? "\u200B" : "\u200C" : null}</>}
          statusRight={activePlanMode ? <Text color={tuiTheme.accent}>{activeLanguage === "zh" ? "计划" : "Plan"}</Text> : null}
        />
      ) : null}
      </Box>}
    />
  )
}

export async function runInteractiveChat(args: Args, model: SwitchableModel, modelConfig: RuntimeModelConfig) {
  const resolvedConfig=await loadStoredConfig(args.workspace)
  const agentProfile=resolveAgentProfile(resolvedConfig,args.agent)
  const initialLanguage:DoCodeLanguage=resolvedConfig.language??"en"
  const instructionsForLanguage=(language:DoCodeLanguage)=>[agentProfile?.instructions,outputLanguageInstruction(language)].filter(Boolean).join("\n\n")
  let planMode = false
  const initialApprovalMode: ApprovalMode = args.approvalMode
  const policy=await createPolicyEngine(args.workspace,initialApprovalMode)
  const promptExtensions=await loadPromptExtensions(args.workspace)
  const activeSandbox=()=>policy.mode==="full-access"?{type:"local" as const,network:"full" as const}:{...resolvedConfig.sandbox,network:"full" as const}
  const spawnSpec=(command:string,network:SandboxNetworkMode="none")=>createSandboxShellSpawnSpec(args.workspace,activeSandbox(),command,network)
  const hookRunner=new HookRunner(args.workspace,resolvedConfig.hooks,10_000,policy,spawnSpec)
  const mcpManager=new McpManager(args.workspace,resolvedConfig.mcpServers,policy)
  const externalTools=await mcpManager.load()
  const shellRunner=async (...runnerArgs:Parameters<ReturnType<typeof createSandboxShellRunner>>)=>await createSandboxShellRunner(args.workspace,activeSandbox())(...runnerArgs)
  let activeModelConfig=modelConfig
  await hookRunner.fire("sessionStart",{mode:"interactive",model:modelConfig.preset})
  const restored = args.continueSession ? await loadSession(args.workspace, args.sessionId) : null
  const now = new Date().toISOString()
  const sessionId = restored?.session.id ?? `session_${Date.now().toString(36)}`
  let activeSession: SavedSession = restored?.session ?? {
    id: sessionId,
    workspace: args.workspace,
    model: modelConfig.preset,
    createdAt: now,
    updatedAt: now,
    directory: path.join(sessionsRoot(args.workspace), sessionId),
  }
  let events = (restored?.events ?? []) as Array<{ createdAt: string; event: AgentEvent }>
  let activeSessionPersisted = Boolean(restored)
  const approvalBridge = new ApprovalBridge()
  const questionBridge = new QuestionBridge()
  const planReviewBridge = new PlanReviewBridge()
  let eventSink: ((event: AgentEvent) => void) | null = null
  let approvalModeSink: ((mode: ApprovalMode) => void) | null = null
  let planModeSink: ((active: boolean) => void) | null = null
  const conversation = new AgentConversation({
    workspace: args.workspace,
    maxSteps: args.maxSteps,
    requireVerification: true,
    model,
    externalTools,
    profileInstructions:instructionsForLanguage(initialLanguage),
    ...(agentProfile?.tools?.allow?{toolAllowList:agentProfile.tools.allow}:{}),
    ...(agentProfile?.tools?.deny?{toolDenyList:agentProfile.tools.deny}:{}),
    runShell:shellRunner,
    shellSpawnSpec:spawnSpec,
    beforeModelRequest:async(messages)=>{
      const context=await hookRunner.context("beforeModel",{messages:messages.slice(-8)})
      if(context)messages.push({role:"user",content:`Hook context:\n${context}`})
    },
    beforeTool:async(name,toolArgs)=>await hookRunner.context("beforeTool",{name,args:toolArgs}),
    afterTool:async(name,toolArgs,result)=>{await hookRunner.fire("afterTool",{name,args:toolArgs,result})},
    ...(resolvedConfig.subagents?.enabled===false?{}:{delegateTask:async(subtask:string)=>{
      const child=new AgentConversation({workspace:args.workspace,maxSteps:Math.min(args.maxSteps,12),model,approvalMode:"ask",isPlanMode:()=>true,approveShell:async()=>false,approveTool:async()=>false})
      return await child.run(subtask)
    }}),
    checkpointManager: new CheckpointManager(args.workspace, sessionId),
    policy,
    approvalMode: initialApprovalMode,
    isPlanMode: () => planMode,
    approveTool: async (request) => await approvalBridge.request(request),
    approveShell: async (command) => await approvalBridge.request(approvalRequest("shell", { command }, policy.evaluate("shell", { command }))),
    askUser: async (question, options) => await questionBridge.request(question, options),
    enterPlanMode: async () => {
      planMode = true
      planModeSink?.(true)
      return policy.mode
    },
    reviewPlan: async (plan) => {
      const decision = await planReviewBridge.request(plan)
      if (decision === "execute" || decision === "cancel") {
        planMode = false
        planModeSink?.(false)
      }
      return decision
    },
    onEvent: (event) => {
      events.push({ createdAt: new Date().toISOString(), event })
      eventSink?.(event)
    },
  })
  if (restored) conversation.restore(restored.messages)

  const save = async (force = false) => {
    const messages = conversation.history()
    if (!force && !activeSessionPersisted && !messages.length && !events.length) return
    const title = activeSession.title ?? sessionTitleFromMessages(messages)
    const updatedAt = new Date().toISOString()
    await writeFileAtomic(path.join(activeSession.directory, "messages.jsonl"), `${messages.map((message) => JSON.stringify(message)).join("\n")}${messages.length ? "\n" : ""}`)
    await writeFileAtomic(path.join(activeSession.directory, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}${events.length ? "\n" : ""}`)
    const metadata = {
      id: activeSession.id,
      workspace: args.workspace,
      model: activeModelConfig.preset,
      ...(title ? { title } : {}),
      createdAt: activeSession.createdAt ?? updatedAt,
      updatedAt,
      messageCount: messages.length,
    }
    await writeFileAtomic(path.join(activeSession.directory, "session.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    activeSession = { ...metadata, directory: activeSession.directory }
    activeSessionPersisted = true
  }

  const resumeSession = async (id: string) => {
    await save()
    const loaded = await loadSession(args.workspace, id)
    conversation.restore(loaded.messages)
    activeSession = loaded.session
    events = loaded.events as Array<{ createdAt: string; event: AgentEvent }>
    activeSessionPersisted = true
    return loaded
  }

  const renameCurrentSession = async (title: string) => {
    activeSession = { ...activeSession, title: title.trim() }
    await save(true)
    return activeSession
  }

  const exportCurrentSession = async (format: "md" | "json", output?: string) => {
    await save(true)
    return await exportSession(args.workspace, activeSession.id, format, output)
  }

  const mainOutput = createPausableOutput(process.stdout)
  let mainInstance: ReturnType<typeof render> | undefined
  let renderRevision = 0
  let alternateViewerOpen = false
  let activeViewerInput: ((input: string, key: ViewerInputKey) => void) | undefined
  const openTranscriptViewer = async (items: TranscriptItem[], language: DoCodeLanguage) => {
    if (alternateViewerOpen) return
    alternateViewerOpen = true
    // Remove the inline frame before saving the primary buffer. A later
    // terminal resize can then only reflow blank rows, never old borders.
    mainInstance?.clear()
    mainOutput.pause()
    let closeViewer: (() => void) | undefined
    const closed = new Promise<void>((resolve) => { closeViewer = resolve })
    const inputBridge = new ViewerInputBridge()
    activeViewerInput = (input, key) => inputBridge.dispatch(input, key)
    let viewer: ReturnType<typeof render> | undefined
    let primaryScreenRestored = false
    const restorePrimaryScreen = () => {
      if (primaryScreenRestored) return
      primaryScreenRestored = true
      process.stdout.write("\u001b[?7h\u001b[?1049l")
    }
    process.once("exit", restorePrimaryScreen)
    try {
      // Scope the alternate screen to this viewer. We intentionally manage
      // entry/exit here instead of Ink's `alternateBuffer` option because
      // Ink mirrors its last alternate frame back to the primary screen on
      // teardown. That behavior is useful for full-screen apps, but corrupts
      // a long-lived inline parent renderer.
      process.stdout.write("\u001b[?1049h\u001b[?7l\u001b[2J\u001b[H")
      viewer = render(
        <AlternateTranscriptViewer items={items} language={language} onClose={() => closeViewer?.()} inputBridge={inputBridge} />,
        {
          stdout: process.stdout,
          stderr: process.stderr,
          stdin: process.stdin,
          exitOnCtrlC: false,
          patchConsole: false,
          standardReactLayoutTiming: true,
        },
      )
      await closed
    } finally {
      if (viewer) {
        viewer.clear()
        viewer.unmount()
      }
      // Reset Ink's incremental frame bookkeeping while writes are still
      // paused. Sending this clear sequence after restoring the primary screen
      // would use alternate-screen dimensions and leave wrapped remnants.
      mainInstance?.clear()
      restorePrimaryScreen()
      process.off("exit", restorePrimaryScreen)
      activeViewerInput = undefined
      alternateViewerOpen = false
      // The primary buffer may have been reflowed while the alternate viewer
      // was resized. Incremental frames queued at several widths can no longer
      // erase each other reliably, so discard them and let the parent Ink tree
      // repaint once from its current React state.
      mainOutput.resume(false)
      renderRevision++
      mainInstance?.rerender(createApp())
    }
  }

  const createApp = () => (
    <ChatApp
      workspace={args.workspace}
      model={modelConfig.preset}
      reasoningEffort={modelConfig.reasoningEffort??"medium"}
      thinkingMode={modelConfig.thinkingMode??"auto"}
      approvalMode={initialApprovalMode}
      initialPlanMode={planMode}
      sessionId={sessionId}
      {...(restored?.session.title ? { sessionTitle: restored.session.title } : {})}
      restored={Boolean(restored)}
      {...(agentProfile?.name ? { agent: agentProfile.name } : {})}
      initialMessages={restored?.messages ?? []}
      initialEvents={restored?.events ?? []}
      conversation={conversation}
      approvalBridge={approvalBridge}
      questionBridge={questionBridge}
      planReviewBridge={planReviewBridge}
      policy={policy}
      setApprovalMode={(mode) => {
        policy.setMode(mode)
      }}
      setPlanMode={(active) => {
        planMode = active
      }}
      attachEventSink={(sink) => { eventSink = sink }}
      attachApprovalModeSink={(sink) => { approvalModeSink = sink }}
      attachPlanModeSink={(sink) => { planModeSink = sink }}
      runShellShortcut={async (command) => await executeTool("shell", { command }, {
        workspace: args.workspace,
        policy,
        approvalMode: initialApprovalMode,
        isPlanMode: () => planMode,
        approveTool: async (request) => await approvalBridge.request(request),
        approveShell: async (requested) => await approvalBridge.request(approvalRequest("shell", { command: requested }, policy.evaluate("shell", { command: requested }))),
        runShell:shellRunner,
        shellSpawnSpec:spawnSpec,
      })}
      listSessions={async () => await listSessions(args.workspace)}
      resumeSession={resumeSession}
      renameCurrentSession={renameCurrentSession}
      exportCurrentSession={exportCurrentSession}
      save={save}
      reportError={async (error, operation, category, context) => await reportError({
        error, operation, ...(category ? { category } : {}), workspace: args.workspace, sessionId: activeSession.id, model: activeModelConfig.preset,
        context: { input: context, approvalMode: args.approvalMode, maxSteps: args.maxSteps, stats: conversation.stats(), messages: conversation.history().slice(-30), events: events.slice(-150) },
      })}
      modelPresets={listModelPresets(resolvedConfig)}
      promptExtensions={promptExtensions}
      language={initialLanguage}
      openTranscriptViewer={openTranscriptViewer}
      forwardTranscriptViewerInput={(input, key) => activeViewerInput?.(input, key)}
      renderRevision={renderRevision}
      setLanguage={async(language)=>{
        await saveLanguagePreference(language)
        await conversation.setProfileInstructions(instructionsForLanguage(language))
      }}
      switchModel={async(preset)=>{
        const next=await resolveRuntimeModelConfig(args.workspace,preset,undefined,activeModelConfig.reasoningEffort,activeModelConfig.thinkingMode)
      model.switchTo(next.preset,createChatModel(next))
        activeModelConfig=next
        activeSession={...activeSession,model:next.preset}
        return next
      }}
      switchEffort={async(effort)=>{
        const next=await resolveRuntimeModelConfig(args.workspace,activeModelConfig.preset,undefined,effort,activeModelConfig.thinkingMode)
        model.switchTo(next.preset,createChatModel(next))
        activeModelConfig=next
        return next
      }}
      switchThinking={async(mode)=>{
        const next=await resolveRuntimeModelConfig(args.workspace,activeModelConfig.preset,undefined,activeModelConfig.reasoningEffort,mode)
        model.switchTo(next.preset,createChatModel(next))
        activeModelConfig=next
        return next
      }}
    />
  )
  mainInstance = render(
    createApp(),
    {
      ...INTERACTIVE_RENDER_OPTIONS,
      stdout: mainOutput.stdout,
      stderr: process.stderr,
      stdin: process.stdin,
    },
  )
  await mainInstance.waitUntilExit()
  await save()
  await hookRunner.fire("sessionEnd",{sessionId:activeSession.id})
  mcpManager.close()
}
