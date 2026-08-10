import { useCallback, useEffect } from "react"
import { MaxSessionTurnsError } from "../../turn-limits.js"
import { createToolPresentation } from "../../tool-presentation.js"
import { expandPromptExtension } from "../../extension-registry.js"
import { createEditor } from "../editor.js"
import { enqueueMessage, takeNextMessage } from "../message-queue.js"
import { routeSlashCommand } from "../slash-command-router.js"
import { commandOutput } from "../command-output.js"
import { executeSlashCommand } from "../slash-command-controller.js"
import { turnSubmissionDisposition } from "../turn-submission-model.js"
import { hasBlockingDialog } from "../dialog-coordinator.js"
import { CLEAR_COMMAND, DIFF_COMMAND } from "../shortcut-command-policy.js"
import type { ChatAppProps } from "../chat-app-types.js"
import type { AttachmentActions } from "./use-attachment-actions.js"
import type { ChatAppState } from "./use-chat-app-state.js"
import type { SessionActions } from "./use-session-actions.js"
import type { TranscriptController } from "./use-transcript-controller.js"

export function useTurnSubmission(props: ChatAppProps, state: ChatAppState, transcript: TranscriptController, attachments: AttachmentActions, sessions: SessionActions, exit: () => void) {
  const SHELL_TOOL_NAME = "shell"
  const submit = useCallback((rawInput: string) => {
    const input = rawInput.trim()
    const composer = state.composerOwner.getSnapshot()
    const images = composer.attachments
    const disposition = turnSubmissionDisposition(input, images.length, state.turnOwner.getSnapshot().running)
    if (disposition === "ignore") return
    if (disposition === "queue") {
      state.setQueuedInputs((current) => enqueueMessage(current, input)); state.setEditor(createEditor()); state.setHistoryIndex(null); state.setHistoryDraft(""); return
    }
    state.setEditor(createEditor()); state.setHistory((current) => [...current.filter((value) => value !== input), input]); state.setHistoryIndex(null); state.setHistoryDraft("")
    if (state.activeModel === "未配置模型" && !input.startsWith("/") && !input.startsWith("!")) {
      state.append({ kind: "info", text: state.activeLanguage === "zh" ? "尚未配置模型。输入 /auth 配置模型服务后再开始任务。" : "No model is configured. Use /auth to configure a model provider before starting a task." }); return
    }
    if (executeSlashCommand(input, { props, state, transcript, attachments, sessions, exit })) return

    const route = routeSlashCommand(input, props.promptExtensions?.map((item) => item.name))
    const extension = route.kind === "extension" ? props.promptExtensions?.find((item) => item.name === route.command) : undefined
    const expandedInput = extension && route.kind !== "none" ? expandPromptExtension(extension, route.argument) : input
    const references = images.map((image) => `@${image.reference}`).join(" ")
    const effectiveInput = [expandedInput, references].filter(Boolean).join("\n\n")
    transcript.flushPendingTools()
    state.append({ kind: "user", text: input || images.map((image) => image.name).join(" · ") })
    state.updateAttachedImages([])
    const signal = state.turnOwner.begin()
    void (async () => {
      try {
        if (input.startsWith("!")) {
          const command = input.slice(1).trim()
          if (!command) state.append({ kind: "info", text: "Usage: !<shell-command>, for example !npm test" })
          else { state.setActiveTool(SHELL_TOOL_NAME); const result = await props.runShellShortcut(command); state.append({ kind: "tool", tools: [{ name: SHELL_TOOL_NAME, args: { command }, ok: result.ok, output: result.output, presentation: result.presentation ?? createToolPresentation(SHELL_TOOL_NAME, { command }, result, 0) }] }) }
        } else if (input === DIFF_COMMAND) state.append({ kind: "info", text: (await commandOutput("git", ["diff", "--no-ext-diff", "--", "."], props.workspace)) || "There are no Git changes." })
        else if (input === CLEAR_COMMAND) { await props.conversation.clear(); state.append({ kind: "info", text: "Conversation context cleared. File changes were preserved." }) }
        else {
          const answer = await props.conversation.run(effectiveInput, { signal })
          if (!transcript.hasAssistantOutput() && answer.trim()) state.append({ kind: "assistant", text: answer })
          const stats = props.conversation.stats(); state.setContextPercent(Math.round(stats.currentContextTokens / stats.contextWindow * 100))
        }
        await props.save()
      } catch (error) {
        if (signal.aborted) state.append({ kind: "info", text: "The current task was interrupted." })
        else if (error instanceof MaxSessionTurnsError) state.append({ kind: "info", text: state.activeLanguage === "zh" ? `本次任务已达到最大模型轮次 ${error.maxTurns}。可使用 --max-steps 或 Agent 配置提高限制。` : `This task reached the maximum of ${error.maxTurns} model turns. Increase it with --max-steps or the active agent profile.` })
        else transcript.appendReportedError("Turn failed", error, "agent.turn", { input })
      } finally { transcript.flushPendingTools(); state.turnOwner.finish(); state.setActiveTool(null); transcript.clearLiveAssistant() }
    })()
  }, [attachments, exit, props, sessions, state, transcript])

  useEffect(() => {
    if (state.running || hasBlockingDialog(state.activeDialog) || !state.queuedInputs.length) return
    const next = takeNextMessage(state.queuedInputs)
    state.setQueuedInputs(next.queue)
    if (next.message) queueMicrotask(() => submit(next.message!))
  }, [state.activeDialog, state.queuedInputs, state.running, state.setQueuedInputs, submit])

  return submit
}
