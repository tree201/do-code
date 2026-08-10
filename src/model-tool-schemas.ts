import type { ToolDefinition } from "./protocol.js"

const anthropicCache = new WeakMap<ToolDefinition[], Array<Record<string, unknown>>>()
const geminiCache = new WeakMap<ToolDefinition[], Array<Record<string, unknown>>>()

export function anthropicToolSchemas(tools: ToolDefinition[]) {
  let schemas = anthropicCache.get(tools)
  if (!schemas) {
    schemas = tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters }))
    anthropicCache.set(tools, schemas)
  }
  return schemas
}

export function geminiToolSchemas(tools: ToolDefinition[]) {
  let schemas = geminiCache.get(tools)
  if (!schemas) {
    schemas = tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters }))
    geminiCache.set(tools, schemas)
  }
  return schemas
}
