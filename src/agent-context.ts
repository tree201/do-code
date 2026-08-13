import type { Message } from "./protocol.js"
import type { InstructionMemory } from "./instructions.js"
import { readTaskNote } from "./task-note.js"

const estimatedCharacters = new WeakMap<Message, number>()

function estimateMessage(message: Message) {
  const cached = estimatedCharacters.get(message)
  if (cached !== undefined) return cached
  const characters = JSON.stringify(message).length
  estimatedCharacters.set(message, characters)
  return characters
}

export type AgentContextOptions = {
  workspace: string
  profileInstructions?: string
  enterPlanMode?: unknown
  reviewPlan?: unknown
}

export function buildSystemPrompt(workspace: string, projectInstructions: string, profileInstructions = "", planningEnabled = false, taskNote?: string) {
  return [
    "You are a coding agent working directly in a software repository.",
    `Workspace: ${workspace}`,
    "Inspect the repository before editing. Make the smallest coherent change that completes the user's request.",
    "Use tools to read and modify files. Run relevant tests or checks before finishing whenever possible.",
    "Do not claim a command passed unless you observed its tool result. In the final answer, summarize changes and verification.",
    "Treat chat history as a log. For every task, verify code, Git state, tests, and artifacts directly. When a task needs a durable working note across steps or interruptions, create TASK.md with the workspace file tools and keep Goal, Progress, Evidence, Blocked, and Next current. Do not create it for work that can be completed without a note.",
    "Never return an empty response. After thinking, either call a tool or provide a final user-facing answer.",
    planningEnabled ? "For a genuinely ambiguous, architectural, cross-cutting, or high-risk task, proactively call enter_plan_mode before making changes. Do not enter plan mode for small, obvious tasks." : "",
    planningEnabled ? "While planning, research with read-only tools, discuss material trade-offs with the user through ask_user, and only then submit one concrete implementation plan through exit_plan_mode." : "",
    planningEnabled ? "exit_plan_mode performs the formal approval interaction. Do not separately ask whether the plan is approved. If approved, continue implementing immediately with the unchanged approval mode; if revision or cancellation is requested, stop without editing." : "",
    taskNote ? `Current TASK.md working note:\n\n${taskNote}\n\nUse this as the current task state. Confirm facts against the workspace before acting.` : "",
    profileInstructions ? "Follow the active agent profile instructions below." : "",
    profileInstructions,
    projectInstructions ? "Follow the loaded hierarchical instructions below. More specific project or subdirectory instructions override broader project instructions; project instructions override global preferences when they conflict." : "",
    projectInstructions,
  ]
    .filter(Boolean)
    .join("\n\n")
}

export async function initialAgentMessages(options: AgentContextOptions, memory: InstructionMemory): Promise<Message[]> {
  const taskNote = await readTaskNote(options.workspace)
  return [{
    role: "system",
    content: buildSystemPrompt(
      options.workspace,
      await memory.prompt(),
      options.profileInstructions,
      Boolean(options.enterPlanMode && options.reviewPlan),
      taskNote,
    ),
  }]
}

export function estimateMessages(messages: Message[]) {
  const characters = messages.reduce((total, message) => total + estimateMessage(message), 0)
  return Math.ceil(characters / 3.5)
}
