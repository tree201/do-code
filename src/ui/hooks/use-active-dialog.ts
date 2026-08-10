import { useRef, useSyncExternalStore } from "react"
import type { ActiveDialog } from "../dialog-coordinator.js"

type DialogUpdate = ActiveDialog | ((current: ActiveDialog) => ActiveDialog)

function createDialogStore() {
  let snapshot: ActiveDialog = { kind: "none" }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (update: DialogUpdate) => {
      const next = typeof update === "function" ? update(snapshot) : update
      if (next === snapshot) return
      snapshot = next
      listeners.forEach((listener) => listener())
    },
  }
}

export function useActiveDialog() {
  const storeRef = useRef<ReturnType<typeof createDialogStore> | null>(null)
  if (!storeRef.current) storeRef.current = createDialogStore()
  const store = storeRef.current
  const activeDialog = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return { activeDialog, setActiveDialog: store.set, getActiveDialog: store.getSnapshot }
}
