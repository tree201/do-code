import { useEffect, useRef, useSyncExternalStore } from "react"
import { createTurnOwner } from "../turn-owner.js"

export function useTurnOwner() {
  const ownerRef = useRef<ReturnType<typeof createTurnOwner> | null>(null)
  if (!ownerRef.current) ownerRef.current = createTurnOwner()
  const owner = ownerRef.current
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot)
  useEffect(() => () => owner.destroy(), [owner])
  return { snapshot, owner }
}
