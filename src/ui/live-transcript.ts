import type { AgentEvent } from "../protocol.js"
import { createToolPresentation } from "../tool-presentation.js"
import { blockedTodoCount, type TranscriptTool } from "./transcript-model.js"

type ToolCompletedEvent = Extract<AgentEvent, { type: "tool.completed" }>

export type CompletedToolTranscriptDecision =
  | { kind: "ignore" }
  | { kind: "hidden" | "pending"; tool: TranscriptTool }

export function completedToolTranscript(event: ToolCompletedEvent, args: unknown): CompletedToolTranscriptDecision {
  if (event.name === "ask_user" || event.name === "exit_plan_mode") return { kind: "ignore" }
  const tool: TranscriptTool = {
    callId: event.callId,
    step: event.step,
    name: event.name,
    ok: event.ok,
    output: event.output,
    ...(args === undefined ? {} : { args }),
    presentation: event.presentation ?? createToolPresentation(event.name, args, { ok: event.ok, output: event.output }, 0),
  }
  const hidden = (event.name === "todo_write" || event.name === "todo_read")
    && event.ok
    && blockedTodoCount([tool]) === 0
  return { kind: hidden ? "hidden" : "pending", tool }
}
