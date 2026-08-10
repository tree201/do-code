import type { TranscriptItem } from "./transcript-model.js"

export function visibleTranscriptItem(item: TranscriptItem) {
  return item.kind !== "tool" || !item.hidden
}
