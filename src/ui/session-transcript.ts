import type { DoCodeLanguage } from "../config.js"
import { contentText, type Message, type ToolPresentation } from "../protocol.js"
import { activityGroupKey, createToolPresentation } from "../tool-presentation.js"
import { activityVisibleSignature } from "./activity-summary.js"
import type { PlanProposal } from "../tool-contracts.js"
import { blockedTodoCount, type HistoricalToolEvent, type NewTranscriptItem, type TranscriptTool } from "./transcript-model.js"

export function historicalToolEvents(events: unknown[]) {
  const tools = new Map<string, HistoricalToolEvent>()
  for (const record of events) {
    if (typeof record !== "object" || record === null || !("event" in record)) continue
    const event = (record as { event?: unknown }).event
    if (typeof event !== "object" || event === null || !("type" in event) || !("callId" in event)) continue
    const value = event as Record<string, unknown>
    if (value.type !== "tool.started" && value.type !== "tool.completed") continue
    const callId = typeof value.callId === "string" ? value.callId : ""
    if (!callId) continue
    const current = tools.get(callId) ?? {}
    tools.set(callId, {
      ...current,
      ...(typeof value.step === "number" ? { step: value.step } : {}),
      ...(typeof value.name === "string" ? { name: value.name } : {}),
      ...("args" in value ? { args: value.args } : {}),
      ...(typeof value.ok === "boolean" ? { ok: value.ok } : {}),
      ...(typeof value.output === "string" ? { output: value.output } : {}),
      ...(typeof value.presentation === "object" && value.presentation !== null ? { presentation: value.presentation as ToolPresentation } : {}),
    })
  }
  return tools
}

export function storedToolResult(content: string) {
  if (content.startsWith("OK: ")) return { ok: true, output: content.slice(4) }
  if (content.startsWith("ERROR: ")) return { ok: false, output: content.slice(7) }
  return { ok: true, output: content }
}

export function storedToolArgs(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return { raw: value }
  }
}

export function planProposalFromArgs(args: unknown): PlanProposal | null {
  if (typeof args !== "object" || args === null) return null
  const record = args as Record<string, unknown>
  if (typeof record.title !== "string" || typeof record.summary !== "string") return null
  if (!Array.isArray(record.steps) || !record.steps.every((step) => typeof step === "string")) return null
  const strings = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
  return {
    title: record.title,
    summary: record.summary,
    steps: record.steps,
    files: strings(record.files),
    verification: strings(record.verification),
    risks: strings(record.risks),
  }
}

export function askAnswerPairs(args: unknown, output: string) {
  const record = typeof args === "object" && args !== null ? args as Record<string, unknown> : {}
  const questions = Array.isArray(record.questions) ? record.questions : []
  let answers: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(output) as { answers?: unknown }
    if (typeof parsed.answers === "object" && parsed.answers !== null) answers = parsed.answers as Record<string, unknown>
  } catch { /* Failed or legacy ask_user results may not contain JSON. */ }
  return questions.flatMap((value) => {
    if (typeof value !== "object" || value === null) return []
    const question = value as Record<string, unknown>
    if (typeof question.question !== "string") return []
    const id = typeof question.id === "string" ? question.id : ""
    const header = typeof question.header === "string" && question.header ? `[${question.header}] ` : ""
    const answer = id && typeof answers[id] === "string" ? String(answers[id]) : undefined
    return [{ question: `${header}${question.question}`, ...(answer ? { answer } : {}) }]
  })
}

function interactionItems(args: unknown, output: string, language: DoCodeLanguage): NewTranscriptItem[] {
  const ask = language === "zh" ? "提问" : "Ask"
  const reply = language === "zh" ? "回答" : "Answer"
  return askAnswerPairs(args, output).map((pair) => ({
    kind: "info",
    text: `${ask}: ${pair.question}${pair.answer ? `\n${reply}: ${pair.answer}` : ""}`,
  }))
}

function assistantTextByFirstToolCall(messages: Message[]) {
  const textByCallId = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== "assistant" || !message.content?.trim() || !message.tool_calls?.length) continue
    const firstCall = message.tool_calls[0]
    if (firstCall) textByCallId.set(firstCall.id, message.content)
  }
  return textByCallId
}

export function restoredEventTranscript(events: unknown[], language: DoCodeLanguage, messages: Message[] = []) {
  const items: NewTranscriptItem[] = []
  const argsByCallId = new Map<string, unknown>()
  const assistantTextByCallId = assistantTextByFirstToolCall(messages)
  let pending: { turnId: string; groupKey: string; signature: string; tools: TranscriptTool[] } | null = null
  let hasTurnHistory = false
  const flushTools = () => {
    if (pending?.tools.length) items.push({ kind: "tool", tools: pending.tools })
    pending = null
  }

  for (const record of events) {
    if (typeof record !== "object" || record === null || !("event" in record)) continue
    const raw = (record as { event?: unknown }).event
    if (typeof raw !== "object" || raw === null || !("type" in raw)) continue
    const event = raw as Record<string, unknown>
    const type = typeof event.type === "string" ? event.type : ""
    const turnId = typeof event.turnId === "string" ? event.turnId : ""

    if (type === "turn.started" && typeof event.input === "string") {
      flushTools()
      hasTurnHistory = true
      items.push({ kind: "user", text: event.input })
      continue
    }
    if (type === "tool.started" && typeof event.callId === "string") {
      const assistantText = assistantTextByCallId.get(event.callId)
      if (assistantText?.trim()) {
        flushTools()
        items.push({ kind: "assistant", text: assistantText })
        assistantTextByCallId.delete(event.callId)
      }
      argsByCallId.set(event.callId, event.args)
      continue
    }
    if (type === "tool.completed" && typeof event.callId === "string" && typeof event.name === "string") {
      const step = typeof event.step === "number" ? event.step : 0
      const groupKey = activityGroupKey(event.name, event.callId)
      const args = argsByCallId.get(event.callId)
      const output = typeof event.output === "string" ? event.output : "No stored tool result"
      const ok = event.ok === true
      if (event.name === "ask_user") {
        flushTools()
        items.push(...interactionItems(args, output, language))
        continue
      }
      if (event.name === "exit_plan_mode") {
        flushTools()
        const plan = planProposalFromArgs(args)
        if (plan) items.push({ kind: "plan", plan })
        continue
      }
      const tool: TranscriptTool = {
        callId: event.callId,
        step,
        name: event.name,
        args,
        ok,
        output,
        presentation: typeof event.presentation === "object" && event.presentation !== null
          ? event.presentation as ToolPresentation
          : createToolPresentation(event.name, args, { ok, output }, 0),
      }
      if ((event.name === "todo_write" || event.name === "todo_read") && ok && blockedTodoCount([tool]) === 0) {
        items.push({ kind: "tool", tools: [tool], hidden: true })
        continue
      }
      const signature = activityVisibleSignature([tool], language)
      if (
        pending &&
        pending.turnId === turnId &&
        pending.groupKey === groupKey &&
        pending.signature === signature
      ) pending.tools.push(tool)
      else {
        flushTools()
        pending = { turnId, groupKey, signature, tools: [tool] }
      }
      continue
    }
    if (type === "approval.resolved") {
      continue
    }
    if (type === "turn.completed" && typeof event.output === "string") {
      flushTools()
      if (event.output.trim()) items.push({ kind: "assistant", text: event.output })
      continue
    }
    if (type === "turn.failed" && typeof event.message === "string") {
      flushTools()
      items.push({ kind: event.aborted === true || event.reason === "max_turns" ? "info" : "error", text: event.message })
    }
  }
  flushTools()
  return hasTurnHistory ? items : []
}

export function restoredTranscript(messages: Message[], events: unknown[] = [], language: DoCodeLanguage = "en") {
  const eventTranscript = restoredEventTranscript(events, language, messages)
  if (eventTranscript.length) return eventTranscript
  const items: NewTranscriptItem[] = []
  const results = new Map(messages
    .filter((message): message is Extract<Message, { role: "tool" }> => message.role === "tool")
    .map((message) => [message.tool_call_id, storedToolResult(message.content)]))
  const eventTools = historicalToolEvents(events)
  let fallbackStep = 0
  let pending: { groupKey: string; signature: string; tools: TranscriptTool[] } | null = null
  const flushTools = () => {
    if (pending?.tools.length) items.push({ kind: "tool", tools: pending.tools })
    pending = null
  }
  const appendTool = (tool: TranscriptTool) => {
    const groupKey = activityGroupKey(tool.name, tool.callId)
    const signature = activityVisibleSignature([tool], language)
    if (pending && pending.groupKey === groupKey && pending.signature === signature) pending.tools.push(tool)
    else {
      flushTools()
      pending = { groupKey, signature, tools: [tool] }
    }
  }
  for (const message of messages) {
    if (message.role === "user") {
      flushTools()
      items.push({ kind: "user", text: contentText(message.content).split("\n\nReferenced file context:")[0]! })
    }
    if (message.role !== "assistant") continue
    if (message.content?.trim()) {
      flushTools()
      items.push({ kind: "assistant", text: message.content })
    }
    if (!message.tool_calls?.length) continue
    fallbackStep++
    for (const call of message.tool_calls) {
      const stored = results.get(call.id)
      const event = eventTools.get(call.id)
      const name = event?.name ?? call.function.name
      const args = event?.args ?? storedToolArgs(call.function.arguments)
      const output = event?.output ?? stored?.output ?? "No stored tool result"
      if (name === "ask_user") {
        flushTools()
        items.push(...interactionItems(args, output, language))
        continue
      }
      if (name === "exit_plan_mode") {
        flushTools()
        const plan = planProposalFromArgs(args)
        if (plan) items.push({ kind: "plan", plan })
        continue
      }
      const tool: TranscriptTool = {
        callId: call.id,
        step: event?.step ?? fallbackStep,
        name,
        args,
        ok: event?.ok ?? stored?.ok ?? false,
        output,
        presentation: event?.presentation ?? createToolPresentation(
          name,
          args,
          { ok: event?.ok ?? stored?.ok ?? false, output },
          0,
        ),
      }
      if ((name === "todo_write" || name === "todo_read") && tool.ok && blockedTodoCount([tool]) === 0) {
        items.push({ kind: "tool", tools: [tool], hidden: true })
        continue
      }
      appendTool(tool)
    }
  }
  flushTools()
  return items
}

export function restoredSessionItems(title: string, messages: Message[], events: unknown[] = [], language: DoCodeLanguage = "en"): NewTranscriptItem[] {
  const transcript = restoredTranscript(messages, events, language)
  const conversationCount = transcript.filter((item) => item.kind === "user" || item.kind === "assistant").length
  const toolCount = transcript.filter((item) => item.kind === "tool").reduce((total, item) => total + item.tools.length, 0)
  return [
    { kind: "resume", title, visibleCount: conversationCount, conversationCount, toolCount },
    ...transcript,
  ]
}
