import { contentText, type Message } from "./protocol.js"

const PATH_PATTERN = /(?:^|[\s`'"(])((?:(?:[\w.@+-]+\/)+)?[\w@+-]+\.[\w.-]+)/g
const ERROR_ID_PATTERN = /\b(?:err|error|issue|task)_[a-zA-Z0-9_-]+\b/g
const COMMAND_PATTERN = /(?:npm|pnpm|yarn|pytest|python|go|cargo|mvn|gradle|git)\s+[\w:./@=-]+(?:\s+[\w:./@=-]+){0,4}/g
const ROLLING_SUMMARY_PREFIX = "Rolling conversation summary:"
const LEGACY_SUMMARY_PREFIX = "Previous conversation state after compaction:"

export const DEFAULT_RECENT_CONTEXT_TURNS = 4

export function compactionAnchors(messages: Message[]) {
  const text = messages.map((message) => contentText(message.content)).join("\n")
  const values = [
    ...[...text.matchAll(PATH_PATTERN)].map((match) => match[1]!),
    ...(text.match(ERROR_ID_PATTERN) ?? []),
    ...(text.match(COMMAND_PATTERN) ?? []),
  ]
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 60)
}

export function isConversationSummary(message: Message) {
  if (message.role !== "user") return false
  const content = contentText(message.content)
  return content.startsWith(ROLLING_SUMMARY_PREFIX) || content.startsWith(LEGACY_SUMMARY_PREFIX)
}

export function rollingCompactionSource(messages: Message[], recentTurns = DEFAULT_RECENT_CONTEXT_TURNS, maximumRetainedCharacters = Number.POSITIVE_INFINITY) {
  const turnStarts = messages.flatMap((message, index) => message.role === "user" && !isConversationSummary(message) ? [index] : [])
  if (turnStarts.length <= 1) return null
  let retainFrom = turnStarts.at(-Math.min(recentTurns, turnStarts.length - 1))!
  while (retainFrom < turnStarts.at(-1)! && messageCharacters(messages.slice(retainFrom)) > maximumRetainedCharacters) {
    retainFrom = turnStarts[turnStarts.indexOf(retainFrom) + 1]!
  }
  return { compacted: messages.slice(0, retainFrom), retained: messages.slice(retainFrom) }
}

function messageCharacters(messages: Message[]) {
  return messages.reduce((total, message) => total + JSON.stringify(message).length, 0)
}

export function buildCompactionPrompt(messages: Message[]) {
  const anchors = compactionAnchors(messages)
  const transcript = messages.map((message) => JSON.stringify(message)).join("\n")
  return `Update the rolling conversation summary for a coding agent. This summary replaces only the older completed work below; recent work remains available separately. Use these headings exactly:\nCurrent goal\nConstraints and decisions\nFiles inspected or changed\nTool results and verification\nUnresolved errors\nNext steps\n\nPreserve exact paths, commands, error IDs, user decisions, incomplete work, and whether each verification passed or failed. Never claim unfinished work is complete. Keep only information needed to continue the task; omit routine exploration and verbose successful output.\n\nCritical anchors to retain when relevant:\n${anchors.map((anchor) => `- ${anchor}`).join("\n") || "- none detected"}\n\nOlder conversation and any previous summary:\n${transcript}`
}

export function compactionRetention(messages: Message[], summary: string) {
  const anchors = compactionAnchors(messages)
  const retained = anchors.filter((anchor) => summary.includes(anchor))
  return { anchors, retained, missing: anchors.filter((anchor) => !summary.includes(anchor)), score: anchors.length ? retained.length / anchors.length : 1 }
}

export function continuationState(messages: Message[], summary: string) {
  const retention = compactionRetention(messages, summary)
  const recovered = retention.missing.length ? `\n\nDeterministic recovery anchors:\n${retention.missing.map((anchor) => `- ${anchor}`).join("\n")}` : ""
  return `${ROLLING_SUMMARY_PREFIX}\n${summary.trim()}${recovered}`
}
