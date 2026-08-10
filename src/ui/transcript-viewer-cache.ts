import type { DoCodeLanguage } from "../config.js"
import type { TranscriptItem } from "./transcript-model.js"
import { transcriptViewerText } from "./transcript-model.js"
import { wrapTerminalLines } from "./terminal-text.js"

type CachedTranscript = {
  text: Map<DoCodeLanguage, string>
  lines: Map<string, string[]>
}

const transcriptCache = new WeakMap<TranscriptItem[], CachedTranscript>()

function cachedTranscript(items: TranscriptItem[]) {
  const current = transcriptCache.get(items)
  if (current) return current
  const created: CachedTranscript = { text: new Map(), lines: new Map() }
  transcriptCache.set(items, created)
  return created
}

export function cachedTranscriptViewerText(items: TranscriptItem[], language: DoCodeLanguage) {
  const cache = cachedTranscript(items)
  const current = cache.text.get(language)
  if (current !== undefined) return current
  const text = transcriptViewerText(items, language)
  cache.text.set(language, text)
  return text
}

export function cachedTranscriptViewerLines(items: TranscriptItem[], language: DoCodeLanguage, width: number) {
  const cache = cachedTranscript(items)
  const contentWidth = Math.max(1, width)
  const key = `${language}:${contentWidth}`
  const current = cache.lines.get(key)
  if (current) return current
  const lines = wrapTerminalLines(cachedTranscriptViewerText(items, language), contentWidth)
  cache.lines.set(key, lines)
  return lines
}
