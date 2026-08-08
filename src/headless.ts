import type { AgentRunResult, AgentTraceEvent } from "./session.js"

export const HEADLESS_PROTOCOL_VERSION = 1 as const

export const EXIT_CODES = {
  success: 0,
  argument: 2,
  model: 3,
  tool: 4,
  maxSteps: 5,
  timeout: 6,
  interrupted: 130,
  unknown: 1,
} as const

export type StreamEnvelope = {
  protocolVersion: typeof HEADLESS_PROTOCOL_VERSION
  runId: string
  sequence: number
  createdAt: string
  type: "system.init" | "agent.event" | "result"
  data: unknown
}

export function streamEnvelope(runId: string, sequence: number, type: StreamEnvelope["type"], data: unknown): StreamEnvelope {
  return { protocolVersion: HEADLESS_PROTOCOL_VERSION, runId, sequence, createdAt: new Date().toISOString(), type, data }
}

export function exitCodeForResult(result: AgentRunResult) {
  if (result.status === "completed") return EXIT_CODES.success
  if (result.stopReason === "max_steps") return EXIT_CODES.maxSteps
  if (result.stopReason === "model_error") return EXIT_CODES.model
  if (result.stopReason === "tool_error") return EXIT_CODES.tool
  if (result.stopReason === "timeout") return EXIT_CODES.timeout
  if (result.stopReason === "interrupted") return EXIT_CODES.interrupted
  return EXIT_CODES.unknown
}

export function traceEnvelope(runId: string, event: AgentTraceEvent) {
  return streamEnvelope(runId, event.sequence, "agent.event", event)
}
