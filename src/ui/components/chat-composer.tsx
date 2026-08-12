import React from "react"
import type { ReactNode } from "react"
import { Text } from "ink"
import { IMAGE_ATTACHMENT_TOKEN, pastedTextLabel, type ComposerInlineNode } from "../attachment-model.js"
import { composerStatusText } from "../chat-presentation.js"
import { showInteractiveComposer, showRunningActivity } from "../dialog-coordinator.js"
import { graphemes } from "../editor.js"
import { t } from "../i18n.js"
import { tuiTheme } from "../theme.js"
import { QueuedMessages, RunningStatus } from "./chat-activity.js"
import { Composer } from "./composer.js"
import type { ChatAppProps } from "../chat-app-types.js"
import type { ChatAppState } from "../hooks/use-chat-app-state.js"

export function composerInputContent(value: string, cursor: number, nodes: ComposerInlineNode[] = []): ReactNode[] {
  const content: ReactNode[] = []
  const parts = graphemes(value)
  let text = ""
  let nodeIndex = 0
  let imageIndex = 0
  const flushText = () => {
    if (!text) return
    content.push(text)
    text = ""
  }

  for (const [index, part] of parts.entries()) {
    if (part !== IMAGE_ATTACHMENT_TOKEN && index !== cursor) {
      text += part
      continue
    }
    flushText()
    const isNode = part === IMAGE_ATTACHMENT_TOKEN
    const node = isNode ? nodes[nodeIndex++] : undefined
    const label = node?.kind === "pasted-text"
      ? ` ${pastedTextLabel(node.lineCount)} `
      : isNode ? ` [Image #${++imageIndex}] ` : part
    content.push(isNode && index !== cursor
      ? <Text key={index} color={tuiTheme.accent}>{label}</Text>
      : <Text key={index} inverse={index === cursor}>{label}</Text>)
  }
  flushText()
  if (cursor === parts.length) content.push(<Text key="cursor" inverse> </Text>)
  return content
}

function ComposerInput({ state }: { state: ChatAppState }) {
  return <Text>{composerInputContent(state.editor.value, state.editor.cursor, state.inlineNodes)}
    {!state.editor.value ? <Text dimColor> {t(state.activeLanguage, state.running ? "Current task is running; press Enter to queue a message" : "Enter a task or @file path")}</Text> : null}
  </Text>
}

export function ChatComposer({ props, state }: { props: ChatAppProps; state: ChatAppState }) {
  if (!showInteractiveComposer(state.activeDialog)) return null
  return <Composer
    key="composer"
    running={state.running}
    input={state.viewerItems ? <Text dimColor>{t(state.activeLanguage, "Viewing messages; press Ctrl+T or Esc to return to input")}</Text> : <ComposerInput state={state} />}
    activity={!state.viewerItems && state.running && showRunningActivity(state.activeDialog) ? <RunningStatus activityEpoch={state.activityEpoch} activeTool={state.activeTool} reasoningCharacters={state.reasoningCharacters} language={state.activeLanguage} /> : undefined}
    queue={!state.viewerItems ? <QueuedMessages messages={state.queuedInputs} language={state.activeLanguage} /> : undefined}
    suggestions={state.viewerItems ? undefined : <>{state.visibleCompletionItems.map((item, windowIndex) => { const index = state.completionWindowStart + windowIndex; return <Text key={item.label} inverse={index === state.completionIndex} color={index === state.completionIndex ? tuiTheme.accent : tuiTheme.border}>{index === state.completionIndex ? "›" : " "} {item.label}  <Text dimColor>{item.description}</Text></Text> })}</>}
    attachments={undefined}
    status={<>{state.exitConfirmation
      ? t(state.activeLanguage, "Press Ctrl+C again to exit")
      : composerStatusText({ language: state.activeLanguage, running: state.running, command: state.editor.value.trimStart().startsWith("/"), width: state.terminalWidth, model: state.activeModel, reasoningIntensity: state.activeEffort, thinkingMode: state.activeThinkingMode, contextPercent: state.contextPercent, approvalMode: state.activeApprovalMode, planMode: state.activePlanMode })}{props.renderRevision ? props.renderRevision % 2 ? "\u200B" : "\u200C" : null}</>}
    statusRight={state.activePlanMode ? <Text color={tuiTheme.accent}>{t(state.activeLanguage, "Plan")}</Text> : null}
  />
}
