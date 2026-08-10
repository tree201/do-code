import React from "react"
import { Text } from "ink"
import { composerStatusText } from "../chat-presentation.js"
import { showInteractiveComposer, showRunningActivity } from "../dialog-coordinator.js"
import { t } from "../i18n.js"
import { tuiTheme } from "../theme.js"
import { RunningStatus } from "./chat-activity.js"
import { Composer } from "./composer.js"
import type { ChatAppProps } from "../chat-app-types.js"
import type { ChatAppState } from "../hooks/use-chat-app-state.js"

export function ChatComposer({ props, state }: { props: ChatAppProps; state: ChatAppState }) {
  if (!showInteractiveComposer(state.activeDialog)) return null
  return <Composer
    key="composer"
    running={state.running}
    input={state.viewerItems ? <Text><Text bold color={tuiTheme.accent}>› </Text><Text dimColor>{state.activeLanguage === "zh" ? "正在查看消息；按 Ctrl+T 或 Esc 返回输入" : "Viewing messages; press Ctrl+T or Esc to return to input"}</Text></Text> : <Text>
      <Text bold color={tuiTheme.accent}>› </Text>{state.cursorParts.before}<Text inverse>{state.cursorParts.cursor}</Text>{state.cursorParts.after}
      {!state.editor.value ? <Text dimColor> {t(state.activeLanguage, state.running ? "Current task is running; press Enter to queue a message" : "Enter a task or @file path")}</Text> : null}
    </Text>}
    activity={!state.viewerItems && state.running && showRunningActivity(state.activeDialog) ? <RunningStatus activityEpoch={state.activityEpoch} activeTool={state.activeTool} reasoningCharacters={state.reasoningCharacters} language={state.activeLanguage} /> : undefined}
    suggestions={state.viewerItems ? undefined : <>{state.visibleCompletionItems.map((item, windowIndex) => { const index = state.completionWindowStart + windowIndex; return <Text key={item.label} inverse={index === state.completionIndex} color={index === state.completionIndex ? tuiTheme.accent : tuiTheme.border}>{index === state.completionIndex ? "›" : " "} {item.label}  <Text dimColor>{item.description}</Text></Text> })}</>}
    attachments={!state.viewerItems && state.attachedImages.length ? <Text dimColor>{state.attachedImages.map((image, index) => `[${index + 1}] ${image.name}`).join(" · ")}  /remove-image &lt;index&gt;</Text> : undefined}
    status={<>{state.exitConfirmation
      ? state.activeLanguage === "zh" ? "再次按 Ctrl+C 退出" : "Press Ctrl+C again to exit"
      : composerStatusText({ language: state.activeLanguage, running: state.running, command: state.editor.value.trimStart().startsWith("/"), width: state.terminalWidth, model: state.activeModel, reasoningIntensity: state.activeEffort, thinkingMode: state.activeThinkingMode, contextPercent: state.contextPercent, approvalMode: state.activeApprovalMode, planMode: state.activePlanMode })}{props.renderRevision ? props.renderRevision % 2 ? "\u200B" : "\u200C" : null}</>}
    statusRight={state.activePlanMode ? <Text color={tuiTheme.accent}>{state.activeLanguage === "zh" ? "计划" : "Plan"}</Text> : null}
  />
}
