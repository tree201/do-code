import type { SavedSession } from "../sessions.js"
import type { ApprovalRequest, PlanReviewRequest, UserQuestion } from "./async-bridges.js"
import type { TranscriptItem } from "./transcript-model.js"

export type ActiveDialog =
  | { kind: "none" }
  | { kind: "approval"; request: ApprovalRequest; selectedIndex: number }
  | { kind: "auth" }
  | { kind: "help"; offset: number }
  | { kind: "model" }
  | { kind: "effort" }
  | { kind: "permission-menu"; selectedIndex: number }
  | { kind: "plan-review"; request: PlanReviewRequest; selectedIndex: number }
  | { kind: "question"; request: UserQuestion; selectedIndex: number; draft: string; customAnswer: boolean; returnToOptions: boolean }
  | { kind: "session-picker"; items: SavedSession[]; selectedIndex: number; query: string }
  | { kind: "viewer"; items: TranscriptItem[]; offset: number }

export function hasBlockingDialog(dialog: ActiveDialog) {
  return dialog.kind !== "none" && dialog.kind !== "viewer"
}

export function canOpenHelp(dialog: ActiveDialog) {
  return dialog.kind === "none"
}

export function canOpenTranscriptViewer(dialog: ActiveDialog) {
  return dialog.kind === "none"
}

export function showInteractiveComposer(dialog: ActiveDialog) {
  return !hasBlockingDialog(dialog)
}

export function showRunningActivity(dialog: ActiveDialog) {
  return dialog.kind === "none" || dialog.kind === "viewer"
}
