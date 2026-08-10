import { activityGroupKey } from "../tool-presentation.js"
import type { DoCodeLanguage } from "../config.js"
import type { AgentEvent } from "../protocol.js"
import { completedToolTranscript } from "./live-transcript.js"
import { createLiveAssistantPublisher } from "./live-assistant-publisher.js"
import { reduceLiveTranscript, type LiveActiveTool, type LiveTranscriptState } from "./live-transcript-reducer.js"
import { splitStreamingMarkdown } from "./streaming-markdown.js"
import type { NewTranscriptItem, PendingToolGroup, TranscriptItem, TranscriptTool } from "./transcript-model.js"

export type TranscriptSnapshot = {
  items: TranscriptItem[]
  liveAssistant: string
  pendingToolGroup: PendingToolGroup | null
  activeTool: LiveActiveTool | null
  activityEpoch: number
  reasoningCharacters: number
}

export function createTranscriptOwner(initialItems: TranscriptItem[]) {
  let snapshot: TranscriptSnapshot = {
    items: initialItems,
    liveAssistant: "",
    pendingToolGroup: null,
    activeTool: null,
    activityEpoch: 0,
    reasoningCharacters: 0,
  }
  let liveState: LiveTranscriptState = { liveAssistant: "", reasoningCharacters: 0, activeTool: null, activityEpoch: 0, assistantCommitted: false }
  let nextId = initialItems.length
  let streamGroup = 0
  let streamCommittedLength = 0
  let streamFragmentCount = 0
  const toolArgs = new Map<string, unknown>()
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<TranscriptSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach((listener) => listener())
  }
  const publisher = createLiveAssistantPublisher((liveAssistant) => publish({ liveAssistant }))
  const appendMany = (items: NewTranscriptItem[]) => {
    if (!items.length) return
    publish({ items: [...snapshot.items, ...items.map((item) => ({ ...item, id: nextId++ } as TranscriptItem))] })
  }
  const append = (item: NewTranscriptItem) => appendMany([item])
  const resetStreamingSegment = () => {
    streamCommittedLength = 0
    streamFragmentCount = 0
    streamGroup++
  }
  const publishLiveAssistant = (value: string) => {
    publisher.flush(value)
    if (!value) resetStreamingSegment()
  }
  const queueLiveAssistant = (value: string) => {
    const split = splitStreamingMarkdown(value, streamCommittedLength)
    if (split.stable) {
      append({ kind: "assistant", text: split.stable, streamGroup, continuation: streamFragmentCount > 0 })
      streamFragmentCount++
      liveState = { ...liveState, assistantCommitted: true }
    }
    streamCommittedLength = split.committedLength
    if (split.stable) publisher.flush(split.pending)
    else publisher.schedule(split.pending)
  }
  const commitAssistant = (text: string) => {
    if (!text.trim()) return false
    const pending = text.slice(streamCommittedLength)
    if (pending.trim()) append({ kind: "assistant", text: pending, streamGroup, continuation: streamFragmentCount > 0 })
    liveState = { ...liveState, assistantCommitted: true }
    publishLiveAssistant("")
    return true
  }
  const flushPendingTools = () => {
    const pending = snapshot.pendingToolGroup
    if (!pending?.tools.length) return
    const item = { kind: "tool", tools: pending.tools, id: nextId++ } as TranscriptItem
    publish({ items: [...snapshot.items, item], pendingToolGroup: null })
  }
  const addPendingTool = (tool: TranscriptTool) => {
    const groupKey = activityGroupKey(tool.name, tool.callId)
    const step = tool.step ?? 0
    const current = snapshot.pendingToolGroup
    if (current && (current.groupKey !== groupKey || current.step !== step)) flushPendingTools()
    const pending = snapshot.pendingToolGroup
    publish({ pendingToolGroup: pending && pending.groupKey === groupKey && pending.step === step
      ? { groupKey, step, tools: [...pending.tools, tool] }
      : { groupKey, step, tools: [tool] } })
  }
  const handleEvent = (event: AgentEvent, language: DoCodeLanguage) => {
    const previous = liveState
    const transition = reduceLiveTranscript(previous, event, language)
    liveState = transition.state
    if (transition.effects.flushPendingTools) flushPendingTools()
    if (transition.effects.commitAssistant) commitAssistant(previous.liveAssistant)
    else if (transition.state.liveAssistant !== previous.liveAssistant) {
      if (event.type === "message.delta") queueLiveAssistant(transition.state.liveAssistant)
      else publishLiveAssistant(transition.state.liveAssistant)
    } else if (event.type === "turn.started" && !previous.liveAssistant) resetStreamingSegment()
    if (event.type === "tool.started") {
      const pending = snapshot.pendingToolGroup
      if (pending && pending.groupKey !== activityGroupKey(event.name, event.callId)) flushPendingTools()
      toolArgs.set(event.callId, event.args)
    }
    if (event.type === "tool.completed") {
      const args = toolArgs.get(event.callId)
      toolArgs.delete(event.callId)
      const decision = completedToolTranscript(event, args)
      if (decision.kind === "hidden") { flushPendingTools(); append({ kind: "tool", tools: [decision.tool], hidden: true }) }
      else if (decision.kind !== "ignore") addPendingTool(decision.tool)
    }
    const next = transition.state
    if (next.activityEpoch !== snapshot.activityEpoch || next.reasoningCharacters !== snapshot.reasoningCharacters || next.activeTool !== snapshot.activeTool) {
      publish({ activityEpoch: next.activityEpoch, reasoningCharacters: next.reasoningCharacters, activeTool: next.activeTool })
    }
  }
  const clearLiveAssistant = () => {
    liveState = { ...liveState, liveAssistant: "" }
    publishLiveAssistant("")
  }
  const setActiveTool = (activeTool: LiveActiveTool | null) => {
    liveState = { ...liveState, activeTool }
    publish({ activeTool })
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
    append,
    appendMany,
    flushPendingTools,
    handleEvent,
    clearLiveAssistant,
    setActiveTool,
    hasAssistantOutput: () => liveState.assistantCommitted || Boolean(liveState.liveAssistant.trim()),
    destroy: () => publisher.cancel(),
  }
}

export type TranscriptOwner = ReturnType<typeof createTranscriptOwner>
