import { marked } from "marked"

export type StreamingMarkdownSplit = {
  stable: string
  pending: string
  committedLength: number
}

function stableMarkdownLength(source: string) {
  const tokens = marked.lexer(source, { gfm: true, breaks: false })
  if (!tokens.length) return 0
  const last = tokens.at(-1)
  if (last?.type === "space") return source.length
  if (last?.type === "code") {
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(last.raw)?.[1]
    if (opener && new RegExp(`\\n {0,3}${opener[0]}{${opener.length},}\\s*\\n?$`).test(last.raw)) return source.length
  }
  const pending = last?.raw ?? source
  return Math.max(0, source.length - pending.length)
}

export function splitStreamingMarkdown(source: string, committedLength = 0): StreamingMarkdownSplit {
  const safeCommittedLength = Math.max(0, Math.min(committedLength, source.length))
  const uncommitted = source.slice(safeCommittedLength)
  const newlyStableLength = stableMarkdownLength(uncommitted)
  const nextCommittedLength = safeCommittedLength + newlyStableLength
  return {
    stable: source.slice(safeCommittedLength, nextCommittedLength),
    pending: source.slice(nextCommittedLength),
    committedLength: nextCommittedLength,
  }
}
