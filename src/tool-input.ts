import path from "node:path"
import type { ToolContext } from "./tool-contracts.js"
import { resolveInside } from "./workspace-paths.js"

export const MAX_TOOL_OUTPUT = 40_000

export function text(value: unknown, field: string) {
  if (typeof value !== "object" || value === null || typeof (value as Record<string, unknown>)[field] !== "string") throw new Error(`Expected string field: ${field}`)
  return (value as Record<string, string>)[field]!
}

export function optionalNumber(value: unknown, field: string) {
  if (typeof value !== "object" || value === null) return undefined
  const item = (value as Record<string, unknown>)[field]
  if (item === undefined) return undefined
  if (typeof item !== "number" || !Number.isInteger(item) || item < 0) throw new Error(`Expected non-negative integer: ${field}`)
  return item
}

export function optionalText(value: unknown, field: string) {
  if (typeof value !== "object" || value === null) return undefined
  const item = (value as Record<string, unknown>)[field]
  if (item === undefined) return undefined
  if (typeof item !== "string") throw new Error(`Expected string field: ${field}`)
  return item
}

export function optionalBoolean(value: unknown, field: string) {
  if (typeof value !== "object" || value === null) return undefined
  const item = (value as Record<string, unknown>)[field]
  if (item === undefined) return undefined
  if (typeof item !== "boolean") throw new Error(`Expected boolean field: ${field}`)
  return item
}

export function resolveToolPath(context: Pick<ToolContext, "workspace" | "allowOutsideWorkspace" | "policy" | "approvalMode">, requested: string) {
  if (context.allowOutsideWorkspace || context.policy?.mode === "full-access" || context.approvalMode === "full-access") return path.resolve(context.workspace, requested)
  return resolveInside(context.workspace, requested)
}

export function truncateToolOutput(output: string) {
  if (output.length <= MAX_TOOL_OUTPUT) return output
  const half = Math.floor((MAX_TOOL_OUTPUT - 80) / 2)
  return `${output.slice(0, half)}\n\n... output truncated ...\n\n${output.slice(-half)}`
}
