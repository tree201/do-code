import type { DoCodeLanguage } from "../config.js"
import type { AgentEvent } from "../protocol.js"

export type LiveActiveTool = string | { name: string; args: unknown }

export type LiveTranscriptState = {
  liveAssistant: string
  reasoningCharacters: number
  activeTool: LiveActiveTool | null
  activityEpoch: number
  assistantCommitted: boolean
}

export type LiveTranscriptEffects = {
  flushPendingTools: boolean
  commitAssistant: boolean
}

export type LiveTranscriptTransition = {
  state: LiveTranscriptState
  effects: LiveTranscriptEffects
}

const noEffects = (): LiveTranscriptEffects => ({ flushPendingTools: false, commitAssistant: false })

export function reduceLiveTranscript(
  current: LiveTranscriptState,
  event: AgentEvent,
  language: DoCodeLanguage,
): LiveTranscriptTransition {
  const state = { ...current }
  const effects = noEffects()
  if (event.type === "turn.started") {
    state.liveAssistant = ""
    state.reasoningCharacters = 0
    state.assistantCommitted = false
    effects.flushPendingTools = true
  } else if (event.type === "step.started") {
    state.activityEpoch++
    state.reasoningCharacters = 0
    effects.flushPendingTools = true
  } else if (event.type === "model.retrying") {
    state.activeTool = language === "zh"
      ? `正在重试第 ${event.attempt} 次 · ${Math.ceil(event.delayMs / 1000)} 秒后`
      : `Retrying attempt #${event.attempt} · in ${Math.ceil(event.delayMs / 1000)}s`
  } else if (event.type === "message.delta") {
    state.liveAssistant += event.delta
    effects.flushPendingTools = true
  } else if (event.type === "reasoning.delta") {
    state.reasoningCharacters = event.totalCharacters
  } else if (event.type === "tool.started") {
    state.activityEpoch++
    state.activeTool = event.name === "todo_write" || event.name === "todo_read" ? null : { name: event.name, args: event.args }
    state.liveAssistant = ""
    state.reasoningCharacters = 0
    effects.commitAssistant = Boolean(current.liveAssistant.trim())
  } else if (event.type === "tool.completed") {
    state.activeTool = null
  } else if (event.type === "turn.completed") {
    state.liveAssistant = ""
    state.reasoningCharacters = 0
    effects.flushPendingTools = true
    effects.commitAssistant = Boolean(current.liveAssistant.trim())
  } else if (event.type === "turn.failed") {
    state.liveAssistant = ""
    state.reasoningCharacters = 0
    effects.flushPendingTools = true
  }
  if (effects.commitAssistant) state.assistantCommitted = true
  return { state, effects }
}
