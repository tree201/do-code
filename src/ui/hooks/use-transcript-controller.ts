import { useCallback, useEffect } from "react"
import type { ApprovalChoice } from "../../policy.js"
import type { PlanReviewDecision } from "../../tools.js"
import type { ChatAppProps } from "../chat-app-types.js"
import type { ChatAppState } from "./use-chat-app-state.js"

export function useTranscriptController(props: ChatAppProps, state: ChatAppState) {
  const appendReportedError = useCallback((label: string, error: unknown, operation: string, context?: unknown) => {
    void props.reportError(error, operation, "exception", context).then((report) => {
      state.append({ kind: "error", text: `${label}: ${error instanceof Error ? error.message : String(error)}\nError ID: ${report.id}\nTo inspect it, run: do-code errors show ${report.id}` })
    }).catch(() => state.append({ kind: "error", text: `${label}: ${error instanceof Error ? error.message : String(error)} (failed to write the error report)` }))
  }, [props.reportError, state.append])

  useEffect(() => {
    props.approvalBridge.attach((request) => state.setActiveDialog({ kind: "approval", request, selectedIndex: 0 }))
    props.questionBridge?.attach((request) => {
      state.transcriptOwner.flushPendingTools()
      state.setActiveDialog({ kind: "question", request, selectedIndex: 0, draft: "", customAnswer: request.options.length === 0, returnToOptions: false })
    })
    props.planReviewBridge?.attach((request) => {
      state.transcriptOwner.flushPendingTools()
      state.append({ kind: "plan", plan: request.plan })
      state.setActiveDialog({ kind: "plan-review", request, selectedIndex: 0 })
    })
    props.attachEventSink((event) => state.transcriptOwner.handleEvent(event, state.activeLanguage))
    return () => {
      props.approvalBridge.attach(null)
      props.questionBridge?.attach(null)
      props.planReviewBridge?.attach(null)
      props.attachEventSink(null)
    }
  }, [props, state.activeLanguage, state.append, state.setActiveDialog, state.transcriptOwner])

  const finishApproval = useCallback((choice: ApprovalChoice) => {
    const dialog = state.getActiveDialog()
    if (dialog.kind !== "approval") return
    dialog.request.resolve(choice)
    state.setActiveDialog({ kind: "none" })
  }, [state.getActiveDialog, state.setActiveDialog])
  const finishQuestion = useCallback((answer: string) => {
    const dialog = state.getActiveDialog()
    if (dialog.kind !== "question") return
    dialog.request.resolve(answer)
    const ask = state.activeLanguage === "zh" ? "提问" : "Ask"
    const reply = state.activeLanguage === "zh" ? "回答" : "Answer"
    state.append({ kind: "info", text: `${ask}: ${dialog.request.question}\n${reply}: ${answer}` })
    state.setActiveDialog({ kind: "none" })
  }, [state.activeLanguage, state.append, state.getActiveDialog, state.setActiveDialog])
  const finishPlanReview = useCallback((decision: PlanReviewDecision) => {
    const dialog = state.getActiveDialog()
    if (dialog.kind !== "plan-review") return
    dialog.request.resolve(decision); state.setActiveDialog({ kind: "none" })
  }, [state.getActiveDialog, state.setActiveDialog])

  return {
    appendReportedError,
    flushPendingTools: state.transcriptOwner.flushPendingTools,
    clearLiveAssistant: state.transcriptOwner.clearLiveAssistant,
    hasAssistantOutput: state.transcriptOwner.hasAssistantOutput,
    finishApproval,
    finishQuestion,
    finishPlanReview,
  }
}

export type TranscriptController = ReturnType<typeof useTranscriptController>
