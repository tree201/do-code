import { useEffect, useRef, useSyncExternalStore } from "react"
import { createTranscriptOwner } from "../transcript-owner.js"
import type { TranscriptItem } from "../transcript-model.js"

export function useTranscriptOwner(initialItems: TranscriptItem[]) {
  const ownerRef = useRef<ReturnType<typeof createTranscriptOwner> | null>(null)
  if (!ownerRef.current) ownerRef.current = createTranscriptOwner(initialItems)
  const owner = ownerRef.current
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot)
  useEffect(() => () => owner.destroy(), [owner])
  return { snapshot, owner }
}
