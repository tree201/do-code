import { useCallback, useEffect, useRef } from "react"
import { MaxSessionTurnsError } from "../../turn-limits.js"
import { createToolPresentation } from "../../tool-presentation.js"
import { expandPromptExtension } from "../../extension-registry.js"
import { composerDraftEqual, expandComposerValue, stripAttachmentTokens, type ComposerDraft } from "../attachment-model.js"
import { createEditor } from "../editor.js"
import { enqueueMessage, takeNextMessage } from "../message-queue.js"
import { routeSlashCommand } from "../slash-command-router.js"
import { commandOutput } from "../command-output.js"
import { executeSlashCommand } from "../slash-command-controller.js"
import { turnSubmissionDisposition } from "../turn-submission-model.js"
import { hasBlockingDialog } from "../dialog-coordinator.js"
import { CLEAR_COMMAND, DIFF_COMMAND } from "../shortcut-command-policy.js"
import { t } from "../i18n.js"
import type { ChatAppProps } from "../chat-app-types.js"
import type { ChatAppState } from "./use-chat-app-state.js"
import type { SessionActions } from "./use-session-actions.js"
import type { TranscriptController } from "./use-transcript-controller.js"

const EMPTY_DRAFT: ComposerDraft = { value: "", nodes: [] }
const FOLLOWUP_SUGGESTION_DELAY_MS = 300

export function useTurnSubmission(props: ChatAppProps, state: ChatAppState, transcript: TranscriptController, sessions: SessionActions, exit: () => void) {
  const SHELL_TOOL_NAME = "shell"
  const suggestionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearSuggestion = useCallback(() => {
    if (suggestionTimer.current) clearTimeout(suggestionTimer.current)
    suggestionTimer.current = null
    state.clearFollowupSuggestion()
  }, [state])
  const submit = useCallback((rawInput: string | ComposerDraft) => {
    clearSuggestion()
    const composer = state.composerOwner.getSnapshot()
    const draft = typeof rawInput === "string" ? { value: rawInput, nodes: composer.nodes } : rawInput
    const input = stripAttachmentTokens(draft.value).trim()
    const disposition = turnSubmissionDisposition(input, draft.nodes.length, state.turnOwner.getSnapshot().running)
    if (disposition === "ignore") return
    if (disposition === "queue") {
      state.setQueuedInputs((current) => enqueueMessage(current, draft)); state.setEditor(createEditor()); state.updateInlineNodes([]); state.setHistoryIndex(null); state.setHistoryDraft(EMPTY_DRAFT); return
    }
    state.setEditor(createEditor()); state.updateInlineNodes([]); state.setHistory((current) => current.some((entry) => composerDraftEqual(entry, draft)) ? current : [...current, draft]); state.setHistoryIndex(null); state.setHistoryDraft(EMPTY_DRAFT)
    if (state.activeModel === "未配置模型" && !input.startsWith("/") && !input.startsWith("!")) {
      state.append({ kind: "info", text: t(state.activeLanguage, "No model is configured. Use /auth to configure a model provider before starting a task.") }); return
    }
    if (executeSlashCommand(input, { props, state, transcript, sessions, exit })) return

    const route = routeSlashCommand(input, props.promptExtensions?.map((item) => item.name))
    const extension = route.kind === "extension" ? props.promptExtensions?.find((item) => item.name === route.command) : undefined
    const expandedText = expandComposerValue(draft.value, draft.nodes, "model").trim()
    const expandedRoute = routeSlashCommand(expandedText, props.promptExtensions?.map((item) => item.name))
    const expandedInput = extension && expandedRoute.kind === "extension" ? expandPromptExtension(extension, expandedRoute.argument) : expandedText
    const displayInput = expandComposerValue(draft.value, draft.nodes, "display").trim()
    transcript.flushPendingTools()
    state.append({ kind: "user", text: displayInput })
    const signal = state.turnOwner.begin()
    void (async () => {
      try {
        if (input.startsWith("!")) {
          const command = input.slice(1).trim()
          if (!command) state.append({ kind: "info", text: t(state.activeLanguage, "Usage: !<shell-command>, for example !npm test") })
          else { state.setActiveTool(SHELL_TOOL_NAME); const result = await props.runShellShortcut(command); state.append({ kind: "tool", tools: [{ name: SHELL_TOOL_NAME, args: { command }, ok: result.ok, output: result.output, presentation: result.presentation ?? createToolPresentation(SHELL_TOOL_NAME, { command }, result, 0) }] }) }
        } else if (input === DIFF_COMMAND) state.append({ kind: "info", text: (await commandOutput("git", ["diff", "--no-ext-diff", "--", "."], props.workspace)) || t(state.activeLanguage, "There are no Git changes.") })
        else if (input === CLEAR_COMMAND) { await props.conversation.clear(); state.append({ kind: "info", text: t(state.activeLanguage, "Conversation context cleared. File changes were preserved.") }) }
        else {
          const answer = await props.conversation.run(expandedInput, { signal, displayInput })
          if (!transcript.hasAssistantOutput() && answer.trim()) state.append({ kind: "assistant", text: answer })
          const stats = props.conversation.stats(); state.setContextPercent(Math.round(stats.currentContextTokens / stats.contextWindow * 100))
        }
        await props.save()
        if (props.followupSuggestions !== false && !signal.aborted && !input.startsWith("/") && !input.startsWith("!") && !state.activePlanMode && props.generateFollowupSuggestion) {
          const controller = new AbortController()
          state.followupAbort.current = controller
          void props.generateFollowupSuggestion(controller.signal).then((suggestion) => {
            if (!controller.signal.aborted && state.followupAbort.current === controller && suggestion) {
              suggestionTimer.current = setTimeout(() => {
                if (!controller.signal.aborted && state.followupAbort.current === controller && !state.composerOwner.getSnapshot().editor.value) state.setFollowupSuggestion(suggestion)
              }, FOLLOWUP_SUGGESTION_DELAY_MS)
            }
          })
        }
      } catch (error) {
        if (signal.aborted) state.append({ kind: "info", text: t(state.activeLanguage, "The current task was interrupted.") })
        else if (error instanceof MaxSessionTurnsError) state.append({ kind: "info", text: t(state.activeLanguage, "This task reached the maximum of {maxTurns} model turns. Increase it with --max-steps or the active agent profile.", { maxTurns: error.maxTurns }) })
        else transcript.appendReportedError(t(state.activeLanguage, "Turn failed"), error, "agent.turn", { input })
      } finally { transcript.flushPendingTools(); state.turnOwner.finish(); state.setActiveTool(null); transcript.clearLiveAssistant() }
    })()
  }, [exit, props, sessions, state, transcript])

  useEffect(() => () => {
    state.followupAbort.current?.abort()
    if (suggestionTimer.current) clearTimeout(suggestionTimer.current)
  }, [])

  useEffect(() => {
    if (state.running || hasBlockingDialog(state.activeDialog) || !state.queuedInputs.length) return
    const next = takeNextMessage(state.queuedInputs)
    state.setQueuedInputs(next.queue)
    if (next.message) queueMicrotask(() => submit(next.message!))
  }, [state.activeDialog, state.queuedInputs, state.running, state.setQueuedInputs, submit])

  return (input: string) => submit(input)
}
