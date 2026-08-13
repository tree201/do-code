import { applyCompletion, completionsForEditor } from "./completion.js"
import { attachmentTokenIndex, type ComposerDraft } from "./attachment-model.js"
import { backspaceEditor, createEditor, deleteEditor, insertEditorText, moveEditorCursor, moveEditorEnd, moveEditorHome, moveEditorVertical, redoEditor, undoEditor } from "./editor.js"
import { takeLastMessage } from "./message-queue.js"
import { nextReasoningEffort } from "./model-actions.js"
import { isReasoningEffortShortcut } from "./shortcut-command-policy.js"
import { t } from "./i18n.js"
import type { ChatInputKey } from "./input-routing-types.js"
import type { ChatAppProps } from "./chat-app-types.js"
import type { AttachmentActions } from "./hooks/use-attachment-actions.js"
import type { ChatAppState } from "./hooks/use-chat-app-state.js"
import type { TranscriptController } from "./hooks/use-transcript-controller.js"

function currentDraft(state: ChatAppState): ComposerDraft {
  const snapshot = state.composerOwner.getSnapshot()
  return { value: snapshot.editor.value, nodes: snapshot.nodes }
}

function restoreDraft(state: ChatAppState, draft: ComposerDraft) {
  state.setEditor(createEditor(draft.value))
  state.updateInlineNodes(draft.nodes)
}

function clearDraft(state: ChatAppState) {
  state.setEditor(createEditor())
  state.updateInlineNodes([])
}

export function routeEditorInput(rawInput: string, input: string, key: ChatInputKey, props: ChatAppProps, state: ChatAppState, transcript: TranscriptController, attachments: AttachmentActions, submit: (input: string) => void, exit: () => void) {
  const composer = state.composerOwner.getSnapshot()
  const pasteStart = /^(?:\u001b)?\[200~/
  const isBracketedPaste = Boolean(key.paste) || pasteStart.test(rawInput) || pasteStart.test(input)
  const isClipboardImageShortcut = (key.ctrl || key.meta) && input.toLowerCase() === "v"
  if (isBracketedPaste) {
    state.composerOwner.markPaste()
    const pasted = input.replace(pasteStart, "").replace(/(?:\u001b)?\[201~$/, "")
    if (pasted && !attachments.attachPastedImagePaths(pasted)) attachments.insertPastedText(pasted)
    return
  }
  if (isClipboardImageShortcut) {
    state.composerOwner.markPaste()
    void attachments.attachClipboardImage().catch(() => {})
    return
  }
  if (isReasoningEffortShortcut(input, key)) {
    const effort = nextReasoningEffort(state.activeEffort)
    if (!state.runtimeStore.canSwitchEffort) state.append({ kind: "error", text: t(state.activeLanguage, "This client does not support reasoning effort switching.") })
    else void state.runtimeStore.switchEffort(effort).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Effort switch failed"), error, "effort.switch", { effort }))
    return
  }
  if (state.turnOwner.getSnapshot().running && (key.escape || (key.ctrl && input === "c"))) { state.turnOwner.abort(); return }
  if (key.ctrl && input === "c") {
    if (composer.editor.value) { clearDraft(state); state.clearExitConfirmation() }
    else if (composer.exitConfirmation) exit()
    else state.armExitConfirmation()
    return
  }
  if (composer.exitConfirmation) state.clearExitConfirmation()
  if (key.ctrl && input === "d") { if (!composer.editor.value) exit(); else state.setEditor((current) => deleteEditor(current)); return }
  if ((key.ctrl && (key.return || input === "j")) || (key.meta && key.return)) { state.setEditor((current) => insertEditorText(current, "\n")); return }
  if (!key.ctrl && !key.meta && input.includes("\t")) {
    const tabIndex = input.indexOf("\t")
    let next = insertEditorText(composer.editor, input.slice(0, tabIndex))
    next = applyCompletion(next, state.workspaceFiles, composer.completionIndex, state.customCompletions, state.argumentCompletions, state.activeLanguage)
    const remainder = input.slice(tabIndex + 1)
    const shouldSubmit = /(?:\r\n|\r|\n)$/.test(remainder)
    next = insertEditorText(next, shouldSubmit ? remainder.replace(/(?:\r\n|\r|\n)$/, "") : remainder)
    state.setEditor(next)
    if (shouldSubmit) submit(next.value)
    return
  }
  const isPlainReturn = !key.ctrl && !key.meta && (key.return || /^(?:\r\n|\r|\n)$/.test(input))
  if (isPlainReturn && state.composerOwner.pastedRecently()) return
  const completionItems = completionsForEditor(composer.editor, state.workspaceFiles, state.customCompletions, state.argumentCompletions, state.activeLanguage)?.items ?? []
  if (isPlainReturn && completionItems.length) {
    const index = composer.completionIndex
    const selected = completionItems[((index % completionItems.length) + completionItems.length) % completionItems.length]
    if (selected && composer.editor.value === selected.insert) { submit(composer.editor.value); return }
    const completed = applyCompletion(composer.editor, state.workspaceFiles, index, state.customCompletions, state.argumentCompletions, state.activeLanguage)
    if (selected?.submit) submit(completed.value)
    else state.setEditor(completed)
    return
  }
  const newlineMatches = input.match(/\r\n|\r|\n/g)
  if (!key.ctrl && !key.meta && newlineMatches?.length === 1 && /(?:\r\n|\r|\n)$/.test(input)) { submit(insertEditorText(composer.editor, input.replace(/(?:\r\n|\r|\n)$/, "")).value); return }
  if (key.return) { submit(composer.editor.value); return }
  if (key.tab && completionItems.length) { state.setEditor((current) => applyCompletion(current, state.workspaceFiles, composer.completionIndex, state.customCompletions, state.argumentCompletions, state.activeLanguage)); return }
  if (key.leftArrow) { state.setEditor((current) => moveEditorCursor(current, -1)); return }
  if (key.rightArrow) { state.setEditor((current) => moveEditorCursor(current, 1)); return }
  if (key.home || (key.ctrl && input === "a")) { state.setEditor((current) => moveEditorHome(current)); return }
  if (key.end || (key.ctrl && input === "e")) { state.setEditor((current) => moveEditorEnd(current)); return }
  if (key.backspace || key.delete) {
    const forwardDelete = rawInput.includes("[3~")
    const nodeIndex = attachmentTokenIndex(composer.editor, forwardDelete ? "delete" : "backspace")
    if (nodeIndex >= 0) { attachments.removeInlineNode(nodeIndex); return }
    state.setEditor((current) => forwardDelete ? deleteEditor(current) : backspaceEditor(current))
    return
  }
  if (key.ctrl && input === "u") { clearDraft(state); return }
  if ((key.ctrl || key.meta || key.super) && input.toLowerCase() === "z") { state.setEditor((current) => key.shift ? redoEditor(current) : undoEditor(current)); return }
  if (key.ctrl && input.toLowerCase() === "y") { state.setEditor((current) => redoEditor(current)); return }
  if (completionItems.length && key.upArrow) { state.setCompletionIndex((composer.completionIndex - 1 + completionItems.length) % completionItems.length); return }
  if (key.upArrow && !composer.editor.value && composer.queuedInputs.length) { const editable = takeLastMessage(composer.queuedInputs); state.setQueuedInputs(editable.queue); if (editable.message) restoreDraft(state, editable.message); return }
  if (completionItems.length && key.downArrow) { state.setCompletionIndex((composer.completionIndex + 1) % completionItems.length); return }
  if (key.upArrow && composer.editor.value.includes("\n")) { const moved = moveEditorVertical(composer.editor, -1); if (moved.cursor !== composer.editor.cursor) { state.setEditor(moved); return } }
  if (key.downArrow && composer.editor.value.includes("\n")) { const moved = moveEditorVertical(composer.editor, 1); if (moved.cursor !== composer.editor.cursor) { state.setEditor(moved); return } }
  if (key.upArrow && composer.history.length) { const index = composer.historyIndex === null ? composer.history.length - 1 : Math.max(0, composer.historyIndex - 1); if (composer.historyIndex === null) state.setHistoryDraft(currentDraft(state)); state.setHistoryIndex(index); restoreDraft(state, composer.history[index] ?? { value: "", nodes: [] }); return }
  if (key.downArrow && composer.historyIndex !== null) { const index = composer.historyIndex + 1; if (index >= composer.history.length) { state.setHistoryIndex(null); restoreDraft(state, composer.historyDraft) } else { state.setHistoryIndex(index); restoreDraft(state, composer.history[index] ?? { value: "", nodes: [] }) }; return }
  if (!key.ctrl && !key.meta && !key.super && input) state.setEditor((current) => insertEditorText(current, input))
}
