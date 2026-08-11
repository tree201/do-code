import React from "react"
import { Box, Text } from "ink"
import { AuthDialog } from "./auth-dialog.js"
import { ModelDialog } from "./model-dialog.js"
import { EffortDialog } from "./effort-dialog.js"
import { ApprovalDialog } from "./approval-dialog.js"
import { HelpDialog } from "./help-dialog.js"
import { PermissionModeDialog } from "./permission-mode-dialog.js"
import { PlanReviewDialog } from "./plan-review-dialog.js"
import { QuestionDialog } from "./question-dialog.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"
import { t } from "../i18n.js"
import { tuiTheme } from "../theme.js"
import type { ChatAppProps } from "../chat-app-types.js"
import type { ChatAppState } from "../hooks/use-chat-app-state.js"

export function ChatDialogs({ props, state }: { props: ChatAppProps; state: ChatAppState }) {
  const dialog = state.activeDialog
  if (dialog.kind === "viewer") return null
  return <>
    {dialog.kind === "help" ? <HelpDialog language={state.activeLanguage} width={state.terminalWidth} height={state.terminalHeight} offset={dialog.offset} /> : null}
    {dialog.kind === "auth" && state.runtimeStore.canConfigureAuth ? <AuthDialog currentModel={state.activeModel} language={state.activeLanguage} onClose={() => state.setActiveDialog({ kind: "none" })} onSubmit={state.runtimeStore.configureAuth} registerInputHandler={(handler) => { state.dialogInputHandlers.current.auth = handler }} /> : null}
    {dialog.kind === "model" && state.runtimeStore.canSwitchModel ? <ModelDialog models={state.activeModelPresets} currentModel={state.activeModel} language={state.activeLanguage} onClose={() => state.setActiveDialog({ kind: "none" })} onSelect={state.runtimeStore.switchModel} registerInputHandler={(handler) => { state.dialogInputHandlers.current.model = handler }} {...(state.runtimeStore.canPersistDefaultModel ? { onPersist: state.runtimeStore.persistDefaultModel } : {})} /> : null}
    {dialog.kind === "effort" && state.runtimeStore.canSwitchEffort ? <EffortDialog efforts={["low", "medium", "high", "xhigh", "max"]} currentEffort={state.activeEffort === "default" ? "medium" : state.activeEffort} language={state.activeLanguage} onClose={() => state.setActiveDialog({ kind: "none" })} onSelect={state.runtimeStore.switchEffort} registerInputHandler={(handler) => { state.dialogInputHandlers.current.effort = handler }} {...(state.activeDefaultEffort ? { defaultEffort: state.activeDefaultEffort } : {})} {...(state.runtimeStore.canPersistDefaultReasoningEffort ? { onPersist: state.runtimeStore.persistDefaultReasoningEffort } : {})} /> : null}
    {dialog.kind === "approval" ? <ApprovalDialog request={dialog.request} selectedIndex={dialog.selectedIndex} language={state.activeLanguage} width={state.terminalWidth} /> : null}
    {dialog.kind === "question" ? <QuestionDialog question={dialog.request.question} options={dialog.request.options} selectedIndex={dialog.selectedIndex} draft={dialog.draft} customAnswer={dialog.customAnswer} language={state.activeLanguage} /> : null}
    {dialog.kind === "plan-review" ? <PlanReviewDialog plan={dialog.request.plan} selectedIndex={dialog.selectedIndex} language={state.activeLanguage} width={state.terminalWidth} /> : null}
    {dialog.kind === "permission-menu" ? <PermissionModeDialog currentMode={state.activeApprovalMode} selectedIndex={dialog.selectedIndex} language={state.activeLanguage} /> : null}
    {dialog.kind === "session-picker" && !state.running ? <DialogManager><DialogSurface>
      <Text bold>{t(state.activeLanguage, "Resume a previous session")}</Text><Text dimColor>{t(state.activeLanguage, "Search: {query}  ↑↓ Select · Enter Resume · Esc Cancel", { query: state.sessionPickerQuery || t(state.activeLanguage, "type a title or ID") })}</Text>
      {state.visibleSessions.length ? state.visibleSessions.slice(state.sessionPickerStart, state.sessionPickerStart + 8).map((session, windowIndex) => { const index = state.sessionPickerStart + windowIndex; return <Text key={session.id} inverse={index === state.sessionPickerIndex} color={session.id === state.activeSessionId ? tuiTheme.success : index === state.sessionPickerIndex ? tuiTheme.accent : tuiTheme.border}>{index === state.sessionPickerIndex ? "›" : " "} {session.title ?? session.id}  <Text dimColor>{session.id} · {session.updatedAt}</Text></Text> }) : <Text dimColor>{t(state.activeLanguage, "No matching sessions")}</Text>}
    </DialogSurface></DialogManager> : null}
  </>
}
