import type { DoCodeLanguage } from "../config.js"
import type { ToolPresentation } from "../protocol.js"
import { t } from "./i18n.js"
import type { PlanProposal, TodoItem } from "../tool-contracts.js"
import type { ToolSummaryItem } from "./tool-summary.js"

export type TranscriptTool = ToolSummaryItem & { callId?: string; step?: number }
export type PendingToolGroup = { groupKey: string; signature: string; tools: TranscriptTool[] }

export type TranscriptItem =
  | { id: number; kind: "header"; workspace: string; model: string; sessionId: string; restored: boolean; agent?: string }
  | { id: number; kind: "resume"; title: string; visibleCount: number; conversationCount: number; toolCount: number }
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string; streamGroup?: number; continuation?: boolean }
  | { id: number; kind: "plan"; plan: PlanProposal }
  | { id: number; kind: "tool"; tools: TranscriptTool[]; hidden?: boolean }
  | { id: number; kind: "info" | "error"; text: string }

export type NewTranscriptItem = TranscriptItem extends infer Item
  ? Item extends { id: number }
    ? Omit<Item, "id">
    : never
  : never

export function planMarkdown(plan: PlanProposal, language: DoCodeLanguage) {
  const stepText = (step: PlanProposal["steps"][number]) => typeof step === "string" ? step : step.description
  const steps = plan.steps.map((step, index) => {
    const [first = "", ...rest] = stepText(step).trim().split("\n")
    if (/^\d+[.)]\s+/.test(first)) return [`### ${first}`, ...rest].join("\n")
    if (/^#{1,6}\s+/.test(first) || /^[-*+]\s+/.test(first)) return [first, ...rest].join("\n")
    return [`### ${index + 1}. ${first}`, ...rest].join("\n")
  }).join("\n")
  const sections = [
    `# ${plan.title}`,
    `## ${t(language, "Summary")}`,
    plan.summary,
    `## ${t(language, "Implementation")}`,
    steps,
  ]
  if (plan.files?.length) sections.push(`## ${t(language, "Files")}`, ...plan.files.map((file) => `- \`${file}\``))
  if (plan.verification?.length) sections.push(`## ${t(language, "Verification")}`, ...plan.verification.map((item) => `- ${item}`))
  if (plan.risks?.length) sections.push(`## ${t(language, "Risks")}`, ...plan.risks.map((item) => `- ${item}`))
  return sections.join("\n\n")
}

export function transcriptViewerText(items: TranscriptItem[], language: DoCodeLanguage) {
  const sections: string[] = []
  let assistantGroup: number | undefined
  for (const item of items) {
    if (item.kind === "header") continue
    if (item.kind === "assistant" && item.streamGroup !== undefined && item.streamGroup === assistantGroup) {
      sections[sections.length - 1] += item.text
      continue
    }
    assistantGroup = item.kind === "assistant" ? item.streamGroup : undefined
    if (item.kind === "resume") sections.push(`• ${t(language, "Resumed session")}: ${item.title}`)
    else if (item.kind === "user") sections.push(`› ${t(language, "You")}\n${item.text}`)
    else if (item.kind === "assistant") sections.push(`• do-code\n${item.text}`)
    else if (item.kind === "plan") sections.push(`• ${t(language, "Proposed Plan")}\n${planMarkdown(item.plan, language)}`)
    else if (item.kind === "error" || item.kind === "info") sections.push(item.kind === "error" ? `× ${t(language, "Error")}\n${item.text}` : `• ${item.text}`)
    else if (item.kind === "tool") sections.push(...item.tools.map((tool) => {
      const status = tool.ok ? "✓" : "×"
      const args = tool.args === undefined ? "" : `\n${JSON.stringify(tool.args, null, 2)}`
      return `${status} ${tool.name}${args}\n${tool.output}`
    }))
  }
  return sections.join("\n\n")
}

export function todoItemsFromArgs(args: unknown): TodoItem[] {
  if (typeof args !== "object" || args === null) return []
  const items = (args as Record<string, unknown>).items
  if (!Array.isArray(items)) return []
  return items.flatMap((value) => {
    if (typeof value !== "object" || value === null) return []
    const item = value as Record<string, unknown>
    const status = item.status
    if (typeof item.id !== "string" || typeof item.content !== "string" || !["pending", "in_progress", "completed", "cancelled", "blocked"].includes(String(status))) return []
    return [{ id: item.id, content: item.content, status: status as TodoItem["status"] }]
  })
}

export function activitySucceeded(tools: TranscriptTool[]) {
  return tools.every((tool) => tool.ok) && blockedTodoCount(tools) === 0
}

export function blockedTodoCount(tools: TranscriptTool[]) {
  const blocked = tools
    .filter((tool) => tool.name === "todo_write")
    .reduce((total, tool) => total + todoItemsFromArgs(tool.args).filter((item) => item.status === "blocked").length, 0)
  return blocked
}

export type HistoricalToolEvent = {
  step?: number
  name?: string
  args?: unknown
  ok?: boolean
  output?: string
  presentation?: ToolPresentation
}
