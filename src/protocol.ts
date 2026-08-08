export type JsonSchema = {
  type: "object"
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export type ToolDefinition = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: JsonSchema
  }
}

export type ToolCall = {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }

export type UserContent = string | UserContentPart[]

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: UserContent }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string | null }
  | { role: "tool"; tool_call_id: string; content: string }

export function contentText(content: UserContent | string | null | undefined) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.filter((part): part is Extract<UserContentPart, { type: "text" }> => part.type === "text").map((part) => part.text).join("\n")
}

export type ModelReply = {
  content: string | null
  toolCalls: ToolCall[]
  reasoningContent?: string | null
  finishReason?: string | null
  usage?: { inputTokens: number; outputTokens: number; cachedTokens: number }
}

export type ModelRequestOptions = {
  signal?: AbortSignal
  onContentDelta?: (delta: string) => void
  onReasoningDelta?: (delta: string) => void
  maxOutputTokens?: number
}

export interface ChatModel {
  complete(input: { messages: Message[]; tools: ToolDefinition[] }, options?: ModelRequestOptions): Promise<ModelReply>
}

export type ToolPresentationKind = "explore" | "edit" | "command" | "background-command" | "web" | "plan" | "delegate" | "interaction" | "generic"

export type ToolFileChange = {
  path: string
  additions?: number
  deletions?: number
  lines?: number
  diff?: string[]
  diffLines?: ToolDiffLine[]
}

export type ToolDiffLine = {
  kind: "context" | "add" | "remove"
  text: string
  oldLine?: number
  newLine?: number
}

/** Structured, persisted UI metadata. The model still receives the complete tool output. */
export type ToolPresentation = {
  kind: ToolPresentationKind
  targets?: string[]
  query?: string
  command?: string
  durationMs?: number
  resultCount?: number
  fileChanges?: ToolFileChange[]
  excerpt?: string[]
  hiddenLines?: number
  jobId?: string
  processStatus?: string
}

export const AGENT_EVENT_PROTOCOL_VERSION = 1 as const

type AgentEventBase = {
  protocolVersion: typeof AGENT_EVENT_PROTOCOL_VERSION
  turnId: string
}

export type AgentEvent = AgentEventBase & (
  | { type: "turn.started"; input: string }
  | { type: "step.started"; step: number }
  | { type: "message.delta"; step: number; delta: string }
  | { type: "reasoning.delta"; step: number; characters: number; totalCharacters: number }
  | { type: "tool.started"; step: number; callId: string; name: string; args: unknown }
  | { type: "tool.delta"; step: number; callId: string; name: string; delta: string }
  | { type: "tool.completed"; step: number; callId: string; name: string; ok: boolean; output: string; presentation?: ToolPresentation }
  | { type: "policy.decision"; step: number; callId: string; name: string; decision: "allow" | "ask" | "deny"; risk: "low" | "medium" | "high" | "critical"; reason: string; matchedRule?: string }
  | { type: "approval.requested"; step: number; callId: string; name: string; title: string; detail: string; dangerous: boolean; risk: "low" | "medium" | "high" | "critical"; reason: string; matchedRule?: string }
  | { type: "approval.resolved"; step: number; callId: string; name: string; approved: boolean; choice?: "deny" | "once" | "session" | "always" }
  | { type: "turn.completed"; output: string }
  | { type: "turn.failed"; message: string; aborted: boolean; reason?: "max_turns" }
)

export type AgentEventPayload = AgentEvent extends infer Event
  ? Event extends AgentEventBase
    ? Omit<Event, "protocolVersion" | "turnId">
    : never
  : never
