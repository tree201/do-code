import path from "node:path"
import type { AgentConversation, AgentEvent } from "../agent.js"
import type { RuntimeModelConfig } from "../config.js"
import type { Message } from "../protocol.js"
import { appendJsonLines, exportSession, loadSession, prepareSessionStorage, sessionTitleFromMessages, sessionsRoot, writeFileAtomic, type LoadedSession, type SavedSession } from "../sessions.js"

const TRANSIENT_EVENT_TYPES = new Set<AgentEvent["type"]>(["step.started", "message.delta", "reasoning.delta", "tool.delta", "model.retrying"])

export function durableSessionEvent(event: AgentEvent) {
  return !TRANSIENT_EVENT_TYPES.has(event.type)
}

export function sessionMessageWriteMode(current: Message[], persisted: Message[]) {
  if (current.length < persisted.length) return "rewrite" as const
  return persisted.every((message, index) => current[index] === message) ? "append" as const : "rewrite" as const
}

export async function createInteractiveSessionStore(options: {
  workspace: string
  requestedSessionId?: string
  continueSession: boolean
  modelConfig?: RuntimeModelConfig
  runtime?: () => { session: SavedSession; modelConfig: RuntimeModelConfig; approvalMode: import("../policy.js").ApprovalMode } | undefined
  conversation: () => AgentConversation
}) {
  const initialModelConfig = options.modelConfig ?? options.runtime?.()?.modelConfig
  if (!initialModelConfig) throw new Error("Interactive session store requires a model config")
  await prepareSessionStorage(options.workspace)
  const restored = options.continueSession ? await loadSession(options.workspace, options.requestedSessionId) : null
  const now = new Date().toISOString()
  const sessionId = restored?.session.id ?? `session_${Date.now().toString(36)}`
  let activeSession: SavedSession = restored?.session ?? {
    id: sessionId,
    workspace: options.workspace,
    model: initialModelConfig.preset,
    createdAt: now,
    updatedAt: now,
    directory: path.join(sessionsRoot(options.workspace), sessionId),
  }
  let events = (restored?.events ?? []) as Array<{ createdAt: string; event: AgentEvent }>
  let durableEvents = events.filter((record) => durableSessionEvent(record.event))
  let persistedMessages = [...(restored?.messages ?? [])]
  let persistedDurableEvents = durableEvents.length
  let persisted = Boolean(restored)
  let saveQueue = Promise.resolve()
  const runtimeState = () => options.runtime?.() ?? { session: activeSession, modelConfig: initialModelConfig, approvalMode: activeSession.approvalMode ?? "ask" }

  const performSave = async (force = false) => {
    const messages = options.conversation().history()
    if (!force && !persisted && !messages.length && !durableEvents.length) return false
    const runtime = runtimeState()
    activeSession = runtime.session
    const title = activeSession.title ?? sessionTitleFromMessages(messages)
    const updatedAt = new Date().toISOString()
    const messageFile = path.join(activeSession.directory, "messages.jsonl")
    const eventFile = path.join(activeSession.directory, "events.jsonl")
    if (sessionMessageWriteMode(messages, persistedMessages) === "append") await appendJsonLines(messageFile, messages.slice(persistedMessages.length))
    else await writeFileAtomic(messageFile, `${messages.map((message) => JSON.stringify(message)).join("\n")}${messages.length ? "\n" : ""}`)
    await appendJsonLines(eventFile, durableEvents.slice(persistedDurableEvents))
    const metadata = { id: activeSession.id, workspace: options.workspace, model: runtime.modelConfig.preset, approvalMode: runtime.approvalMode, ...(title ? { title } : {}), createdAt: activeSession.createdAt ?? updatedAt, updatedAt, messageCount: messages.length }
    await writeFileAtomic(path.join(activeSession.directory, "session.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    activeSession = { ...metadata, directory: activeSession.directory }
    persistedMessages = [...messages]
    persistedDurableEvents = durableEvents.length
    persisted = true
    return true
  }
  const save = async (force = false) => {
    const operation = saveQueue.then(() => performSave(force))
    saveQueue = operation.then(() => undefined, () => undefined)
    return await operation
  }
  const resume = async (id: string) => {
    await save()
    const loaded = await loadSession(options.workspace, id)
    options.conversation().restore(loaded.messages)
    activeSession = loaded.session
    events = loaded.events as Array<{ createdAt: string; event: AgentEvent }>
    durableEvents = events.filter((record) => durableSessionEvent(record.event))
    persistedMessages = [...loaded.messages]
    persistedDurableEvents = durableEvents.length
    persisted = true
    return loaded
  }
  const rename = async (title: string) => { activeSession = { ...runtimeState().session, title: title.trim() }; await save(true); return activeSession }
  const exportCurrent = async (format: "md" | "json", output?: string) => { await save(true); return await exportSession(options.workspace, activeSession.id, format, output) }

  return {
    restored,
    sessionId,
    save,
    resume,
    rename,
    exportCurrent,
    recordEvent(event: AgentEvent) {
      const record = { createdAt: new Date().toISOString(), event }
      events.push(record)
      if (durableSessionEvent(event)) durableEvents.push(record)
    },
    events() { return events },
    session() { return runtimeState().session },
    modelConfig() { return runtimeState().modelConfig },
    attachmentDirectory() { return path.join(activeSession.directory, "attachments") },
  }
}

export type InteractiveSessionStore = Awaited<ReturnType<typeof createInteractiveSessionStore>>
