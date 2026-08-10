import type { JsonSchema } from "./protocol.js"

export function toolSchema(properties: Record<string, unknown>, required: string[]): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false }
}

export function stringArray(value: unknown, field: string) {
  if (typeof value !== "object" || value === null) throw new Error(`Expected string array field: ${field}`)
  const item = (value as Record<string, unknown>)[field]
  if (!Array.isArray(item) || item.some((entry) => typeof entry !== "string")) throw new Error(`Expected string array field: ${field}`)
  return item as string[]
}

export function optionalStringArray(value: unknown, field: string) {
  if (typeof value !== "object" || value === null || (value as Record<string, unknown>)[field] === undefined) return []
  return stringArray(value, field)
}
