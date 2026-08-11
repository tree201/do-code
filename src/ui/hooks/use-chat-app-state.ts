import { useMemo, useRef, useState } from "react"
import type { ApprovalMode } from "../../policy.js"
import type { DoCodeLanguage, ReasoningEffort, ThinkingMode } from "../../config.js"
import { localeDefinitions } from "../../locale-registry.js"
import { buildWorkspaceCompletionIndex, completionsForEditor, type ArgumentCompletions } from "../completion.js"
import { editorCursorParts } from "../editor.js"
import { approvalModeNotice, inlineViewerHeight } from "../chat-presentation.js"
import { filterSessions, sessionPickerWindowStart } from "../session-picker-model.js"
import { restoredSessionItems } from "../session-transcript.js"
import type { TranscriptItem } from "../transcript-model.js"
import { cachedTranscriptViewerLines } from "../transcript-viewer-cache.js"
import { t } from "../i18n.js"
import type { ChatAppProps } from "../chat-app-types.js"
import { useActiveDialog } from "./use-active-dialog.js"
import { useRuntimeStore } from "./use-runtime-store.js"
import { useTranscriptOwner } from "./use-transcript-owner.js"
import { useComposerOwner } from "./use-composer-owner.js"
import { useTurnOwner } from "./use-turn-owner.js"
import { APPROVAL_MODE_COMMAND, EFFORT_COMMAND, EXPORT_COMMAND, LANGUAGE_COMMAND, MEMORY_COMMAND, REMOVE_IMAGE_COMMAND, REWIND_COMMAND, THINKING_COMMAND } from "../shortcut-command-policy.js"
import type { ChatInputKey } from "../input-routing-types.js"

export type DialogInputHandler = (input: string, key: ChatInputKey) => void

export function useChatAppState(props: ChatAppProps, initialWidth: number, initialHeight: number) {
  const [terminalWidth, setTerminalWidth] = useState(initialWidth)
  const [terminalHeight, setTerminalHeight] = useState(initialHeight)
  const initialItems: TranscriptItem[] = [
    { id: 0, kind: "header", workspace: props.workspace, model: props.model, sessionId: props.sessionId, restored: props.restored, ...(props.agent ? { agent: props.agent } : {}) },
    ...(props.model === "未配置模型" ? [{ id: 1, kind: "info" as const, text: props.language === "zh" ? "尚未配置模型。输入 /auth 配置模型服务；也可以先查看帮助或退出。" : "No model is configured. Use /auth to configure a provider, or continue exploring the interface." }] : []),
    ...(props.restored ? restoredSessionItems(props.sessionTitle ?? props.sessionId, props.initialMessages, props.initialEvents, props.language ?? "en") : [])
      .map((item, index) => ({ ...item, id: index + (props.model === "未配置模型" ? 2 : 1) } as TranscriptItem)),
  ]
  const { snapshot: transcript, owner: transcriptOwner } = useTranscriptOwner(initialItems)
  const { items, activeTool, activityEpoch, reasoningCharacters, pendingToolGroup, liveAssistant } = transcript
  const { append, appendMany, setActiveTool } = transcriptOwner
  const { snapshot: runtime, store: runtimeStore } = useRuntimeStore(props)
  const activeSessionId = runtime.session.id
  const activeSessionTitle = runtime.session.title ?? ""
  const { snapshot: composer, owner: composerOwner } = useComposerOwner()
  const { editor, attachments: attachedImages, history, historyIndex, historyDraft, queuedInputs, completionIndex, exitConfirmation } = composer
  const { setEditor, setAttachments: updateAttachedImages, setHistory, setHistoryIndex, setHistoryDraft, setQueuedInputs, setCompletionIndex, armExitConfirmation, clearExitConfirmation } = composerOwner
  const { snapshot: turn, owner: turnOwner } = useTurnOwner()
  const running = turn.running
  const updateRunning = turnOwner.setRunning
  const { activeDialog, setActiveDialog, getActiveDialog } = useActiveDialog()
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])
  const [memoryCount, setMemoryCount] = useState(0)
  const [trusted, setTrusted] = useState(false)
  const [contextPercent, setContextPercent] = useState(0)
  const dialogInputHandlers = useRef<{ auth?: DialogInputHandler | undefined; model?: DialogInputHandler | undefined; effort?: DialogInputHandler | undefined }>({})
  const activeModel = runtime.modelConfig.preset
  const activeModelPresets = runtime.modelPresets
  const activeEffort: ReasoningEffort | "default" = runtime.modelConfig.reasoningEffort ?? "default"
  const activeDefaultEffort = runtime.defaultReasoningEffort
  const activeThinkingMode = runtime.modelConfig.thinkingMode ?? "auto"
  const activeLanguage = runtime.language
  const activeApprovalMode = runtime.approvalMode
  const activePlanMode = runtime.planMode
  const externalViewerActiveRef = useRef(false)

  const applyApprovalMode = runtimeStore.setApprovalMode
  const applyPlanMode = runtimeStore.setPlanMode

  const customCompletions = useMemo(() => props.promptExtensions?.map((item) => ({ label: `/${item.name}`, description: item.description, insert: `/${item.name}` })) ?? [], [props.promptExtensions])
  const workspaceCompletionIndex = useMemo(() => buildWorkspaceCompletionIndex(workspaceFiles), [workspaceFiles])
  const argumentCompletions = useMemo<ArgumentCompletions>(() => ({
    [EFFORT_COMMAND]: (["low", "medium", "high", "xhigh", "max"] as ReasoningEffort[]).map((effort) => ({ label: effort, description: t(activeLanguage, effort === activeEffort ? "Current reasoning effort" : "Switch reasoning effort"), insert: effort, submit: true })),
    [THINKING_COMMAND]: (["auto", "on", "off"] as ThinkingMode[]).map((mode) => ({ label: mode, description: t(activeLanguage, mode === activeThinkingMode ? "Current thinking mode" : mode === "auto" ? "Let the model decide when to think" : mode === "on" ? "Force thinking on" : "Turn thinking off"), insert: mode, submit: true })),
    [LANGUAGE_COMMAND]: localeDefinitions.map((language) => ({ label: language.id, description: t(activeLanguage, `Set interface and output language to ${language.englishName}`), insert: language.id, submit: true })),
    [APPROVAL_MODE_COMMAND]: (["ask", "auto", "full-access"] as ApprovalMode[]).map((mode) => ({ label: mode, description: approvalModeNotice(mode, activeLanguage).split("\n").slice(1).join(" "), insert: mode, submit: true })),
    [MEMORY_COMMAND]: ["list", "show", "reload"].map((value) => ({ label: value, description: t(activeLanguage, `${value} project instructions`), insert: value, submit: true })),
    [REWIND_COMMAND]: ["both", "chat", "files"].map((value) => ({ label: value, description: t(activeLanguage, `Rewind ${value}`), insert: value, submit: true })),
    [EXPORT_COMMAND]: ["md", "json"].map((value) => ({ label: value, description: t(activeLanguage, `Export the session as ${value}`), insert: value, submit: true })),
    [REMOVE_IMAGE_COMMAND]: attachedImages.map((image, index) => ({ label: String(index + 1), description: image.name, insert: String(index + 1), submit: true })),
  }), [activeEffort, activeLanguage, activeThinkingMode, attachedImages])
  const completion = useMemo(() => completionsForEditor(editor, workspaceFiles, customCompletions, argumentCompletions, activeLanguage, workspaceCompletionIndex), [activeLanguage, argumentCompletions, customCompletions, editor, workspaceCompletionIndex, workspaceFiles])
  const cursorParts = useMemo(() => editorCursorParts(editor), [editor])
  const completionItems = completion?.items ?? []
  const completionWindowStart = Math.max(0, Math.min(completionIndex - 4, completionItems.length - 6))
  const viewerHeight = inlineViewerHeight(terminalWidth, terminalHeight)
  const viewerRows = Math.max(3, viewerHeight - 4)
  const viewerItems = activeDialog.kind === "viewer" ? activeDialog.items : null
  const viewerOffset = activeDialog.kind === "viewer" ? activeDialog.offset : Number.MAX_SAFE_INTEGER
  const sessionPickerItems = activeDialog.kind === "session-picker" ? activeDialog.items : null
  const sessionPickerIndex = activeDialog.kind === "session-picker" ? activeDialog.selectedIndex : 0
  const sessionPickerQuery = activeDialog.kind === "session-picker" ? activeDialog.query : ""
  const viewerLines = useMemo(() => viewerItems ? cachedTranscriptViewerLines(viewerItems, activeLanguage, Math.max(8, terminalWidth - 4)) : [], [activeLanguage, terminalWidth, viewerItems])
  const viewerMaximum = Math.max(0, viewerLines.length - viewerRows)
  const visibleSessions = useMemo(() => filterSessions(sessionPickerItems ?? [], sessionPickerQuery), [sessionPickerItems, sessionPickerQuery])

  return {
    terminalWidth, terminalHeight, setTerminalWidth, setTerminalHeight, items, activeSessionId, activeSessionTitle, runtimeStore,
    editor, setEditor, composerOwner, running, turnOwner, updateRunning, activeTool, setActiveTool, activityEpoch, reasoningCharacters,
    pendingToolGroup, liveAssistant, transcriptOwner, activeDialog, setActiveDialog, getActiveDialog,
    history, setHistory, historyIndex, setHistoryIndex, historyDraft, setHistoryDraft, workspaceFiles, setWorkspaceFiles, completionIndex, setCompletionIndex,
    sessionPickerItems, sessionPickerIndex, sessionPickerQuery, memoryCount, setMemoryCount,
    trusted, setTrusted, contextPercent, setContextPercent, dialogInputHandlers, queuedInputs, setQueuedInputs, activeModel, activeModelPresets, attachedImages,
    updateAttachedImages, activeEffort, activeDefaultEffort,
    activeThinkingMode, activeLanguage, activeApprovalMode, activePlanMode, viewerItems,
    viewerOffset, externalViewerActiveRef, exitConfirmation, armExitConfirmation, clearExitConfirmation,
    applyApprovalMode, applyPlanMode, append, appendMany, customCompletions, argumentCompletions,
    completionItems, completionWindowStart, visibleCompletionItems: completionItems.slice(completionWindowStart, completionWindowStart + 6), cursorParts,
    viewerHeight, viewerRows, viewerLines,
    viewerMaximum, effectiveViewerOffset: Math.min(viewerMaximum, Math.max(0, viewerOffset)), visibleSessions, sessionPickerStart: sessionPickerWindowStart(sessionPickerIndex, visibleSessions.length),
  }
}

export type ChatAppState = ReturnType<typeof useChatAppState>
