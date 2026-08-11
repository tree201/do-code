import type { ApprovalChoice, ApprovalMode } from "../policy.js"
import type { PlanReviewDecision } from "../tools.js"
import { approvalModeNotice } from "./chat-presentation.js"
import { canOpenHelp, canOpenTranscriptViewer } from "./dialog-coordinator.js"
import { isHelpShortcut } from "./shortcut-command-policy.js"
import { helpDialogLines } from "./components/help-dialog.js"
import type { ChatInputKey } from "./input-routing-types.js"
import type { ChatAppProps } from "./chat-app-types.js"
import type { ChatAppState } from "./hooks/use-chat-app-state.js"
import type { SessionActions } from "./hooks/use-session-actions.js"
import type { TranscriptController } from "./hooks/use-transcript-controller.js"

export function routeDialogInput(rawInput: string, input: string, key: ChatInputKey, props: ChatAppProps, state: ChatAppState, transcript: TranscriptController, sessions: SessionActions) {
  const dialog = state.getActiveDialog()
  const isHelpToggle = isHelpShortcut(input, key)
  const isViewerToggle = key.ctrl && (input.toLowerCase() === "t" || rawInput === "\u0014")
  if (state.externalViewerActiveRef.current) {
    props.forwardTranscriptViewerInput?.(rawInput, {
      ...(key.ctrl === undefined ? {} : { ctrl: key.ctrl }),
      ...(key.escape === undefined ? {} : { escape: key.escape }),
      ...(key.upArrow === undefined ? {} : { upArrow: key.upArrow }),
      ...(key.downArrow === undefined ? {} : { downArrow: key.downArrow }),
      ...(key.pageUp === undefined ? {} : { pageUp: key.pageUp }),
      ...(key.pageDown === undefined ? {} : { pageDown: key.pageDown }),
      ...(key.home === undefined ? {} : { home: key.home }),
      ...(key.end === undefined ? {} : { end: key.end }),
    })
    return true
  }
  if (dialog.kind === "auth") return true
  if (dialog.kind === "help") {
    const lines = helpDialogLines(state.activeLanguage, state.terminalWidth)
    const rows = Math.max(5, Math.min(20, state.terminalHeight - 8))
    const maximum = Math.max(0, lines.length - rows)
    if (isHelpToggle || key.escape) state.setActiveDialog({ kind: "none" })
    else if (key.upArrow) updateDialog(state, "help", (current) => ({ ...current, offset: Math.max(0, current.offset - 1) }))
    else if (key.downArrow) updateDialog(state, "help", (current) => ({ ...current, offset: Math.min(maximum, current.offset + 1) }))
    else if (key.pageUp) updateDialog(state, "help", (current) => ({ ...current, offset: Math.max(0, current.offset - rows) }))
    else if (key.pageDown) updateDialog(state, "help", (current) => ({ ...current, offset: Math.min(maximum, current.offset + rows) }))
    else if (key.home) state.setActiveDialog({ kind: "help", offset: 0 })
    else if (key.end) state.setActiveDialog({ kind: "help", offset: maximum })
    return true
  }
  if (isHelpToggle && canOpenHelp(dialog)) { state.setActiveDialog({ kind: "help", offset: 0 }); return true }
  if (dialog.kind === "viewer") {
    if (isViewerToggle || key.escape) state.setActiveDialog({ kind: "none" })
    else if (key.upArrow) state.setActiveDialog({ ...dialog, offset: Math.max(0, state.effectiveViewerOffset - 1) })
    else if (key.downArrow) state.setActiveDialog({ ...dialog, offset: Math.min(state.viewerMaximum, state.effectiveViewerOffset + 1) })
    else if (key.pageUp) state.setActiveDialog({ ...dialog, offset: Math.max(0, state.effectiveViewerOffset - state.viewerRows) })
    else if (key.pageDown) state.setActiveDialog({ ...dialog, offset: Math.min(state.viewerMaximum, state.effectiveViewerOffset + state.viewerRows) })
    else if (key.home) state.setActiveDialog({ ...dialog, offset: 0 })
    else if (key.end) state.setActiveDialog({ ...dialog, offset: state.viewerMaximum })
    return true
  }
  if (isViewerToggle && canOpenTranscriptViewer(dialog)) {
    if (props.openTranscriptViewer) {
      state.externalViewerActiveRef.current = true
      void props.openTranscriptViewer([...state.items], state.activeLanguage).finally(() => { state.externalViewerActiveRef.current = false })
    } else state.setActiveDialog({ kind: "viewer", items: state.items, offset: Number.MAX_SAFE_INTEGER })
    return true
  }
  if ((key.tab && key.shift) || rawInput === "\u001b[Z") { state.applyPlanMode(!state.activePlanMode); return true }
  if (dialog.kind === "approval") {
    const choices: ApprovalChoice[] = ["once", "session", "always", "deny"]
    if (key.upArrow) state.setActiveDialog({ ...dialog, selectedIndex: Math.max(0, dialog.selectedIndex - 1) })
    else if (key.downArrow) state.setActiveDialog({ ...dialog, selectedIndex: Math.min(choices.length - 1, dialog.selectedIndex + 1) })
    else if (key.return) transcript.finishApproval(choices[dialog.selectedIndex]!)
    else if (/^[1-4]$/.test(input)) transcript.finishApproval(choices[Number(input) - 1]!)
    else if (input.toLowerCase() === "y") transcript.finishApproval("once")
    else if (input.toLowerCase() === "n" || key.escape) transcript.finishApproval("deny")
    return true
  }
  if (dialog.kind === "plan-review") {
    const decisions: PlanReviewDecision[] = ["execute", "revise", "cancel"]
    if (key.upArrow) state.setActiveDialog({ ...dialog, selectedIndex: Math.max(0, dialog.selectedIndex - 1) })
    else if (key.downArrow) state.setActiveDialog({ ...dialog, selectedIndex: Math.min(decisions.length - 1, dialog.selectedIndex + 1) })
    else if (key.return) transcript.finishPlanReview(decisions[dialog.selectedIndex]!)
    else if (/^[1-3]$/.test(input)) transcript.finishPlanReview(decisions[Number(input) - 1]!)
    else if (key.escape) transcript.finishPlanReview("cancel")
    return true
  }
  if (dialog.kind === "permission-menu") {
    const modes: ApprovalMode[] = ["ask", "auto", "full-access"]
    const update = (next: number) => state.setActiveDialog({ ...dialog, selectedIndex: next })
    if (key.upArrow) update(Math.max(0, dialog.selectedIndex - 1))
    else if (key.downArrow) update(Math.min(modes.length - 1, dialog.selectedIndex + 1))
    else if (key.return) finishPermissionMenu(modes[dialog.selectedIndex]!, state)
    else if (/^[1-3]$/.test(input)) finishPermissionMenu(modes[Number(input) - 1]!, state)
    else if (key.escape) finishPermissionMenu(undefined, state)
    return true
  }
  if (dialog.kind === "question") {
    const otherIndex = dialog.request.options.findIndex((option) => option.startsWith("Other —"))
    if (key.escape) {
      if (dialog.customAnswer && dialog.returnToOptions) state.setActiveDialog({ ...dialog, selectedIndex: otherIndex, draft: "", customAnswer: false, returnToOptions: false })
      else transcript.finishQuestion("User cancelled the question")
    } else if (!dialog.customAnswer && key.upArrow) state.setActiveDialog({ ...dialog, selectedIndex: Math.max(0, dialog.selectedIndex - 1) })
    else if (!dialog.customAnswer && key.downArrow) state.setActiveDialog({ ...dialog, selectedIndex: Math.min(dialog.request.options.length - 1, dialog.selectedIndex + 1) })
    else if (key.return) {
      if (dialog.customAnswer) {
        const answer = dialog.draft.trim()
        if (answer) transcript.finishQuestion(answer)
      } else if (otherIndex >= 0 && dialog.selectedIndex === otherIndex) state.setActiveDialog({ ...dialog, draft: "", customAnswer: true, returnToOptions: true })
      else transcript.finishQuestion(dialog.request.options[dialog.selectedIndex] ?? "")
    } else if (dialog.customAnswer && (key.backspace || key.delete)) state.setActiveDialog({ ...dialog, draft: Array.from(dialog.draft).slice(0, -1).join("") })
    else if (dialog.customAnswer && !key.ctrl && !key.meta && !key.super && input) state.setActiveDialog({ ...dialog, draft: dialog.draft + input })
    return true
  }
  if (dialog.kind === "session-picker") {
    if (key.escape || (key.ctrl && input === "c")) state.setActiveDialog({ kind: "none" })
    else if (key.upArrow) state.setActiveDialog({ ...dialog, selectedIndex: Math.max(0, dialog.selectedIndex - 1) })
    else if (key.downArrow) state.setActiveDialog({ ...dialog, selectedIndex: Math.min(Math.max(0, state.visibleSessions.length - 1), dialog.selectedIndex + 1) })
    else if (key.return) { const selected = state.visibleSessions[dialog.selectedIndex]; if (selected) sessions.resumeSelectedSession(selected.id) }
    else if (key.backspace || key.delete) state.setActiveDialog({ ...dialog, selectedIndex: 0, query: Array.from(dialog.query).slice(0, -1).join("") })
    else if (!key.ctrl && !key.meta && !key.super && input) state.setActiveDialog({ ...dialog, selectedIndex: 0, query: dialog.query + input })
    return true
  }
  return false
}

function finishPermissionMenu(mode: ApprovalMode | undefined, state: ChatAppState) {
  if (mode) {
    state.applyApprovalMode(mode)
    state.append({ kind: "info", text: approvalModeNotice(mode, state.activeLanguage) })
  }
  state.setActiveDialog({ kind: "none" })
}

function updateDialog<K extends ChatAppState["activeDialog"]["kind"]>(state: ChatAppState, kind: K, update: (dialog: Extract<ChatAppState["activeDialog"], { kind: K }>) => ChatAppState["activeDialog"]) {
  state.setActiveDialog((current) => current.kind === kind ? update(current as Extract<ChatAppState["activeDialog"], { kind: K }>) : current)
}
