import type { ToolDefinition } from "./protocol.js"
import { toolDefinitions } from "./tools.js"

const PLAN_TOOLS = new Set(["enter_plan_mode", "exit_plan_mode"])

export type ToolVisibilityOptions = {
  toolAllowList?: string[]
  toolDenyList?: string[]
}

export function toolEnabled(name: string, options: ToolVisibilityOptions) {
  if (PLAN_TOOLS.has(name)) return false
  if (options.toolDenyList?.some((entry) => entry === "*" || entry === name)) return false
  return !options.toolAllowList?.length || options.toolAllowList.some((entry) => entry === "*" || entry === name)
}

export function availableToolDefinitions(
  options: ToolVisibilityOptions & { externalTools?: Array<{ definition: ToolDefinition }> },
) {
  return [...toolDefinitions, ...(options.externalTools ?? []).map((tool) => tool.definition)].filter((tool) => toolEnabled(tool.function.name, options))
}
