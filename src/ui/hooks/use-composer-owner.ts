import { useEffect, useRef, useSyncExternalStore } from "react"
import { createComposerOwner } from "../composer-owner.js"

export function useComposerOwner() {
  const ownerRef = useRef<ReturnType<typeof createComposerOwner> | null>(null)
  if (!ownerRef.current) ownerRef.current = createComposerOwner()
  const owner = ownerRef.current
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot)
  useEffect(() => () => owner.destroy(), [owner])
  return { snapshot, owner }
}
