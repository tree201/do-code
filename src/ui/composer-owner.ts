import { composerDraftEqual, type ComposerDraft, type ComposerInlineNode } from "./attachment-model.js"
import { createEditor, type EditorState } from "./editor.js"

export type ComposerSnapshot = {
  editor: EditorState
  nodes: ComposerInlineNode[]
  history: ComposerDraft[]
  historyIndex: number | null
  historyDraft: ComposerDraft
  queuedInputs: ComposerDraft[]
  completionIndex: number
  exitConfirmation: boolean
}

type ValueUpdate<T> = T | ((current: T) => T)

const emptyDraft = (): ComposerDraft => ({ value: "", nodes: [] })

export function createComposerOwner() {
  let snapshot: ComposerSnapshot = { editor: createEditor(), nodes: [], history: [], historyIndex: null, historyDraft: emptyDraft(), queuedInputs: [], completionIndex: 0, exitConfirmation: false }
  let recentPasteAt = 0
  let exitTimer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<ComposerSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach((listener) => listener())
  }
  const update = <K extends keyof ComposerSnapshot>(key: K, value: ValueUpdate<ComposerSnapshot[K]>) => {
    const next = typeof value === "function" ? (value as (current: ComposerSnapshot[K]) => ComposerSnapshot[K])(snapshot[key]) : value
    if (!Object.is(next, snapshot[key])) publish({ [key]: next })
  }
  const clearExitConfirmation = () => {
    if (exitTimer) clearTimeout(exitTimer)
    exitTimer = null
    if (snapshot.exitConfirmation) publish({ exitConfirmation: false })
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
    setEditor(value: ValueUpdate<EditorState>) {
      const next = typeof value === "function" ? value(snapshot.editor) : value
      const restored = snapshot.historyIndex === null ? undefined : snapshot.history[snapshot.historyIndex]
      publish({ editor: next, completionIndex: 0, ...(restored && next.value !== restored.value ? { historyIndex: null } : {}) })
    },
    setNodes(value: ValueUpdate<ComposerInlineNode[]>) {
      const next = typeof value === "function" ? value(snapshot.nodes) : value
      const restored = snapshot.historyIndex === null ? undefined : snapshot.history[snapshot.historyIndex]
      publish({ nodes: next, ...(restored && !composerDraftEqual({ value: snapshot.editor.value, nodes: next }, restored) ? { historyIndex: null } : {}) })
    },
    setHistory: (value: ValueUpdate<ComposerDraft[]>) => update("history", value),
    setHistoryIndex: (value: ValueUpdate<number | null>) => update("historyIndex", value),
    setHistoryDraft: (value: ValueUpdate<ComposerDraft>) => update("historyDraft", value),
    setQueuedInputs: (value: ValueUpdate<ComposerDraft[]>) => update("queuedInputs", value),
    setCompletionIndex: (value: ValueUpdate<number>) => update("completionIndex", value),
    markPaste: () => { recentPasteAt = Date.now() },
    pastedRecently: (windowMs = 500) => Date.now() - recentPasteAt < windowMs,
    armExitConfirmation() {
      if (exitTimer) clearTimeout(exitTimer)
      publish({ exitConfirmation: true })
      exitTimer = setTimeout(clearExitConfirmation, 2_000)
    },
    clearExitConfirmation,
    destroy() { if (exitTimer) clearTimeout(exitTimer) },
  }
}

export type ComposerOwner = ReturnType<typeof createComposerOwner>
