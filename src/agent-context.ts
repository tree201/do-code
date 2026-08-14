import type { Message } from "./protocol.js"
import type { InstructionMemory } from "./instructions.js"
import { readTaskNote } from "./task-note.js"
import { durableMemoryPrompt } from "./durable-memory.js"

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
  publishPlan?: unknown
}

export function buildSystemPrompt(workspace: string, projectInstructions: string, profileInstructions = "", planningEnabled = false, taskNote?: string, durableMemories?: string, relevantMemories?: string) {
  return [
    "You are a coding agent working directly in a software repository.",
    `Workspace: ${workspace}`,
    "Inspect the repository before editing. Make the smallest coherent change that completes the user's request.",
    "Use tools to read and modify files. Run relevant tests or checks before finishing whenever possible.",
    "Do not claim a command passed unless you observed its tool result. In the final answer, summarize changes and verification.",
    "Treat chat history as a log. For every task, verify code, Git state, tests, and artifacts directly. When a task needs a durable working note across steps or interruptions, use the write_task_note tool and keep Goal, Progress, Evidence, Blocked, and Next current. Do not create it for work that can be completed without a note.",
    "Never return an empty response. After thinking, either call a tool or provide a final user-facing answer.",
    planningEnabled ? "The user controls Plan mode with Shift+Tab. Do not enter or leave Plan mode yourself." : "",
    taskNote ? `Current task note:\n\n${taskNote}\n\nUse this as the current task state. Confirm facts against the workspace before acting.` : "",
    durableMemories,
    profileInstructions ? "Follow the active agent profile instructions below." : "",
    profileInstructions,
    projectInstructions ? "Follow the loaded hierarchical instructions below. More specific project or subdirectory instructions override broader project instructions; project instructions override global preferences when they conflict." : "",
    projectInstructions,
    relevantMemories,
  ]
    .filter(Boolean)
    .join("\n\n")
}

export async function initialAgentMessages(options: AgentContextOptions, memory: InstructionMemory, relevantMemories?: string): Promise<Message[]> {
  const [taskNote, durableMemories] = await Promise.all([readTaskNote(options.workspace), durableMemoryPrompt(options.workspace)])
  return [{
    role: "system",
    content: buildSystemPrompt(
      options.workspace,
      await memory.prompt(),
      options.profileInstructions,
      Boolean(options.enterPlanMode && options.publishPlan),
      taskNote,
      durableMemories,
      relevantMemories,
    ),
  }]
}

export function estimateMessages(messages: Message[]) {
  const characters = messages.reduce((total, message) => total + estimateMessage(message), 0)
  return Math.ceil(characters / 3.5)
}
