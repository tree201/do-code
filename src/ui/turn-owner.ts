export type TurnSnapshot = { running: boolean }

export function createTurnOwner() {
  let snapshot: TurnSnapshot = { running: false }
  let controller: AbortController | null = null
  const listeners = new Set<() => void>()
  const setRunning = (running: boolean) => {
    if (running === snapshot.running) return
    snapshot = { running }
    listeners.forEach((listener) => listener())
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
    setRunning,
    begin() { controller = new AbortController(); setRunning(true); return controller.signal },
    finish() { controller = null; setRunning(false) },
    abort() { controller?.abort() },
    destroy() { controller?.abort(); controller = null },
  }
}

export type TurnOwner = ReturnType<typeof createTurnOwner>
