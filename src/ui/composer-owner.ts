import type { ImageAttachment } from "./attachment-model.js"
import { createEditor, type EditorState } from "./editor.js"

export type ComposerSnapshot = {
  editor: EditorState
  attachments: ImageAttachment[]
  history: string[]
  historyIndex: number | null
  historyDraft: string
  queuedInputs: string[]
  completionIndex: number
  exitConfirmation: boolean
}

type ValueUpdate<T> = T | ((current: T) => T)

export function createComposerOwner() {
  let snapshot: ComposerSnapshot = { editor: createEditor(), attachments: [], history: [], historyIndex: null, historyDraft: "", queuedInputs: [], completionIndex: 0, exitConfirmation: false }
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
      publish({ editor: next, completionIndex: 0 })
    },
    setAttachments: (value: ValueUpdate<ImageAttachment[]>) => update("attachments", value),
    setHistory: (value: ValueUpdate<string[]>) => update("history", value),
    setHistoryIndex: (value: ValueUpdate<number | null>) => update("historyIndex", value),
    setHistoryDraft: (value: ValueUpdate<string>) => update("historyDraft", value),
    setQueuedInputs: (value: ValueUpdate<string[]>) => update("queuedInputs", value),
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
