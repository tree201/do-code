import type { TranscriptItem } from "./transcript-model.js"

export type TranscriptBoundary = "none" | "space" | "divider"

export function visibleTranscriptItem(item: TranscriptItem) {
  return item.kind !== "tool" || !item.hidden
}

export function transcriptBoundary(
  previous: TranscriptItem | undefined,
  current: TranscriptItem,
): TranscriptBoundary {
  if (!previous || current.kind === "assistant" && current.continuation) return "none"
  if (previous.kind === "tool" && !previous.hidden && (current.kind === "assistant" || current.kind === "plan")) return "divider"
  return "space"
}
