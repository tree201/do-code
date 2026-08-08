import { contentText, type Message } from "./protocol.js"

const PATH_PATTERN = /(?:^|[\s`'"(])((?:(?:[\w.@+-]+\/)+)?[\w@+-]+\.[\w.-]+)/g
const ERROR_ID_PATTERN = /\b(?:err|error|issue|task)_[a-zA-Z0-9_-]+\b/g
const COMMAND_PATTERN = /(?:npm|pnpm|yarn|pytest|python|go|cargo|mvn|gradle|git)\s+[\w:./@=-]+(?:\s+[\w:./@=-]+){0,4}/g

export function compactionAnchors(messages: Message[]) {
  const text = messages.map((message) => contentText(message.content)).join("\n")
  const values = [
    ...[...text.matchAll(PATH_PATTERN)].map((match) => match[1]!),
    ...(text.match(ERROR_ID_PATTERN) ?? []),
    ...(text.match(COMMAND_PATTERN) ?? []),
  ]
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 60)
}

export function buildCompactionPrompt(messages: Message[]) {
  const anchors = compactionAnchors(messages)
  const transcript = messages.map((message) => JSON.stringify(message)).join("\n")
  return `Compress the conversation into a continuation state for another coding agent. Use these headings exactly:\nCurrent goal\nConstraints and decisions\nFiles inspected or changed\nTool results and verification\nUnresolved errors\nNext steps\n\nPreserve exact paths, commands, error IDs, user decisions, incomplete work, and whether each verification passed or failed. Never claim unfinished work is complete.\n\nCritical anchors to retain when relevant:\n${anchors.map((anchor) => `- ${anchor}`).join("\n") || "- none detected"}\n\nConversation:\n${transcript}`
}

export function compactionRetention(messages: Message[], summary: string) {
  const anchors = compactionAnchors(messages)
  const retained = anchors.filter((anchor) => summary.includes(anchor))
  return { anchors, retained, missing: anchors.filter((anchor) => !summary.includes(anchor)), score: anchors.length ? retained.length / anchors.length : 1 }
}

export function continuationState(messages: Message[], summary: string) {
  const retention = compactionRetention(messages, summary)
  const recovered = retention.missing.length ? `\n\nDeterministic recovery anchors:\n${retention.missing.map((anchor) => `- ${anchor}`).join("\n")}` : ""
  return `Previous conversation state after compaction:\n${summary.trim()}${recovered}`
}
