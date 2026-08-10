import type { AgentProfileConfig } from "./config-contracts.js"
import type { ApprovalMode } from "./policy-contracts.js"

export function migrateAgentProfiles(value: unknown, source: string): Record<string, AgentProfileConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}.agents must be an object`)
  const agents: Record<string, AgentProfileConfig> = {}
  for (const [name, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (!entryValue || typeof entryValue !== "object" || Array.isArray(entryValue)) throw new Error(`${source}.agents.${name} must be an object`)
    const agent = entryValue as Record<string, unknown>
    if (agent.approvalMode !== undefined && !["ask", "auto", "full-access"].includes(String(agent.approvalMode))) throw new Error(`${source}.agents.${name}.approvalMode is invalid`)
    if (agent.maxSteps !== undefined && (!Number.isInteger(agent.maxSteps) || Number(agent.maxSteps) < 1)) throw new Error(`${source}.agents.${name}.maxSteps must be a positive integer`)
    const toolRules = agent.tools as Record<string, unknown> | undefined
    agents[name] = {
      ...(typeof agent.model === "string" ? { model: agent.model } : {}),
      ...(typeof agent.approvalMode === "string" ? { approvalMode: agent.approvalMode as ApprovalMode } : {}),
      ...(typeof agent.instructions === "string" ? { instructions: agent.instructions } : {}),
      ...(typeof agent.maxSteps === "number" ? { maxSteps: agent.maxSteps } : {}),
      ...(toolRules && typeof toolRules === "object" ? { tools: { ...(toolRules.allow !== undefined ? { allow: strings(toolRules.allow, `${source}.agents.${name}.tools.allow`) } : {}), ...(toolRules.deny !== undefined ? { deny: strings(toolRules.deny, `${source}.agents.${name}.tools.deny`) } : {}) } } : {}),
    }
  }
  return agents
}

function strings(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be an array of strings`)
  return value as string[]
}
