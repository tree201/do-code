import type { PlanProposal, TodoStatus, ToolImplementation } from "./tool-contracts.js"
import { optionalStringArray, stringArray, toolSchema } from "./tool-definition-helpers.js"
import { text } from "./tool-input.js"
import { TOOL_NAMES } from "./tool-names.js"
import { deleteDurableMemory, listDurableMemories, readDurableMemory, writeDurableMemory, type MemoryScope, type MemoryType } from "./durable-memory.js"
import { writeTaskNote } from "./task-note.js"

function memoryScope(value: unknown): MemoryScope {
  if (value === "user" || value === "project") return value
  throw new Error("scope must be user or project")
}

function memoryType(value: unknown): MemoryType {
  if (value === "user" || value === "feedback" || value === "project" || value === "reference") return value
  throw new Error("type must be user, feedback, project, or reference")
}

const memoryListTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.MEMORY_LIST,
    description: "List durable user and project memories. Use this when the user asks what is remembered or before reading a specific memory.",
    parameters: toolSchema({ scope: { type: "string", enum: ["user", "project"] } }, []),
  } },
  async execute(args, context) {
    const scope = (args as Record<string, unknown>).scope
    const memories = await listDurableMemories(context.workspace, scope === undefined ? undefined : memoryScope(scope))
    return { ok: true, output: memories.length ? memories.map((memory) => `${memory.scope}/${memory.path} — ${memory.name}`).join("\n") : "No durable memories" }
  },
}

const memoryReadTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.MEMORY_READ,
    description: "Read a named durable memory. Use details from a memory only after reading it, and verify any current repository claims separately.",
    parameters: toolSchema({ scope: { type: "string", enum: ["user", "project"] }, path: { type: "string" } }, ["scope", "path"]),
  } },
  async execute(args, context) {
    const scope = memoryScope((args as Record<string, unknown>).scope)
    const memory = await readDurableMemory(context.workspace, scope, text(args, "path"))
    return { ok: true, output: memory.content }
  },
}

const memoryWriteTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.MEMORY_WRITE,
    description: "Save or update one durable memory when the conversation reveals a lasting user preference, user background, project context, or external reference. Use user scope for cross-project user facts and preferences; use project scope for current-project context. Do not save code structure, transient task state, test logs, secrets, or speculation.",
    parameters: toolSchema({ scope: { type: "string", enum: ["user", "project"] }, type: { type: "string", enum: ["user", "feedback", "project", "reference"] }, name: { type: "string" }, description: { type: "string" }, content: { type: "string" } }, ["scope", "type", "name", "description", "content"]),
  } },
  async execute(args, context) {
    const scope = memoryScope((args as Record<string, unknown>).scope)
    const type = memoryType((args as Record<string, unknown>).type)
    const name = text(args, "name")
    await writeDurableMemory(context.workspace, { scope, type, name, description: text(args, "description"), content: text(args, "content") })
    return { ok: true, output: `Saved durable memory: ${scope}/${type}/${name}` }
  },
}

const memoryDeleteTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.MEMORY_DELETE,
    description: "Delete a durable memory only when the user explicitly asks to forget it.",
    parameters: toolSchema({ scope: { type: "string", enum: ["user", "project"] }, path: { type: "string" } }, ["scope", "path"]),
  } },
  async execute(args, context) {
    const scope = memoryScope((args as Record<string, unknown>).scope)
    const memoryPath = text(args, "path")
    await deleteDurableMemory(context.workspace, scope, memoryPath)
    return { ok: true, output: `Deleted durable memory: ${scope}/${memoryPath}` }
  },
}

const writeTaskNoteTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.WRITE_TASK_NOTE,
    description: "Create or replace the durable task note used to track goal, progress, evidence, blockers, and next step across model requests. The note is stored outside the workspace and refreshed automatically before each request.",
    parameters: toolSchema({ content: { type: "string" } }, ["content"]),
  } },
  async execute(args, context) {
    const content = text(args, "content")
    if (!content.trim()) return { ok: false, output: "content must not be empty" }
    await writeTaskNote(context.workspace, content)
    return { ok: true, output: "Saved task note" }
  },
}

export const delegateTaskTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.DELEGATE_TASK,
    description: "Delegate one bounded, independently useful read-only research task to a child agent. Do not use this for ordinary repository inspection that the main agent can complete directly.",
    parameters: toolSchema({ task: { type: "string", description: "A concrete, self-contained subtask" } }, ["task"]),
  } },
  async execute(args, context) {
    if (!context.delegateTask) return { ok: false, output: "Subagents are disabled in configuration" }
    return { ok: true, output: await context.delegateTask(text(args, "task"), context.signal) }
  },
}

const enterPlanModeTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.ENTER_PLAN_MODE,
    description: "Enter a safe read-only planning phase for an ambiguous, cross-cutting, architectural, or high-risk task. Do not use this for small, obvious changes.",
    parameters: toolSchema({ reason: { type: "string" } }, ["reason"]),
  } },
  async execute(args, context) {
    if (!context.enterPlanMode) return { ok: false, output: "Interactive plan mode is unavailable in this run" }
    const previousMode = await context.enterPlanMode(text(args, "reason"))
    return { ok: true, output: `Entered read-only plan mode. Approval mode remains ${previousMode}. Research the repository, resolve material choices with ask_user, then submit a concrete plan with exit_plan_mode.` }
  },
}

const exitPlanModeTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.EXIT_PLAN_MODE,
    description: "Publish a finalized implementation plan to the conversation. Remain in read-only Plan mode; the user switches to an execution mode with Shift+Tab when ready to implement.",
    parameters: toolSchema({ title: { type: "string" }, summary: { type: "string" }, steps: { type: "array", minItems: 1, items: { type: "string" } }, files: { type: "array", items: { type: "string" } }, verification: { type: "array", items: { type: "string" } }, risks: { type: "array", items: { type: "string" } } }, ["title", "summary", "steps"]),
  } },
  async execute(args, context) {
    if (!context.publishPlan) return { ok: false, output: "Interactive plan publishing is unavailable in this run" }
    const proposal: PlanProposal = {
      title: text(args, "title"),
      summary: text(args, "summary"),
      steps: stringArray(args, "steps"),
      files: optionalStringArray(args, "files"),
      verification: optionalStringArray(args, "verification"),
      risks: optionalStringArray(args, "risks"),
    }
    context.publishPlan(proposal)
    return { ok: true, output: "Published the plan. Remain in read-only Plan mode; the user can switch to an execution mode with Shift+Tab when ready." }
  },
}

const askUserTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.ASK_USER,
    description: "Ask 1-4 blocking, structured clarification questions when a material choice cannot be inferred safely.",
    parameters: toolSchema({ questions: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", properties: {
      id: { type: "string" }, header: { type: "string", maxLength: 12 }, question: { type: "string" },
      options: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label", "description"], additionalProperties: false } },
    }, required: ["id", "header", "question"], additionalProperties: false } } }, ["questions"]),
  } },
  async execute(args, context) {
    if (!context.askUser) return { ok: false, output: "User input is unavailable in this run" }
    const record = args as Record<string, unknown>
    const rawQuestions = Array.isArray(record.questions) ? record.questions.slice(0, 4) : []
    if (!rawQuestions.length) return { ok: false, output: "questions must contain 1-4 items" }
    const answers: Record<string, string> = {}
    for (const [index, rawQuestion] of rawQuestions.entries()) {
      if (!rawQuestion || typeof rawQuestion !== "object") return { ok: false, output: `Question ${index + 1} is invalid` }
      const question = rawQuestion as Record<string, unknown>
      if (typeof question.id !== "string" || typeof question.header !== "string" || typeof question.question !== "string") return { ok: false, output: `Question ${index + 1} requires id, header, and question` }
      if (question.header.length > 12) return { ok: false, output: `Question header must be 12 characters or fewer: ${question.header}` }
      const rawOptions = Array.isArray(question.options) ? question.options : []
      if (rawOptions.length && (rawOptions.length < 2 || rawOptions.length > 4)) return { ok: false, output: `Question ${question.id} requires 2-4 options` }
      const options = rawOptions.map((rawOption) => {
        if (!rawOption || typeof rawOption !== "object") throw new Error(`Invalid option in question ${question.id}`)
        const option = rawOption as Record<string, unknown>
        if (typeof option.label !== "string" || typeof option.description !== "string") throw new Error(`Options require label and description in question ${question.id}`)
        return `${option.label} — ${option.description}`
      })
      if (options.length) options.push("Other — Enter a different answer")
      const selected = await context.askUser(`[${question.header}] ${question.question}`, options)
      const matching = rawOptions.find((rawOption) => typeof rawOption === "object" && rawOption !== null && selected.startsWith(`${String((rawOption as Record<string, unknown>).label)} —`)) as Record<string, unknown> | undefined
      answers[question.id] = matching ? String(matching.label) : selected.startsWith("Other —") ? "Other" : selected
    }
    return { ok: true, output: JSON.stringify({ answers }, null, 2) }
  },
}

const todoWriteTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.TODO_WRITE,
    description: "Replace the current task plan. Keep exactly one item in_progress while work remains.",
    parameters: toolSchema({ items: { type: "array", items: { type: "object", properties: { id: { type: "string" }, content: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled", "blocked"] } }, required: ["id", "content", "status"], additionalProperties: false } } }, ["items"]),
  } },
  async execute(args, context) {
    const raw = (args as Record<string, unknown>).items
    if (!Array.isArray(raw)) return { ok: false, output: "items must be an array" }
    const items = raw.map((item) => item as Record<string, unknown>)
    if (items.some((item) => typeof item.id !== "string" || typeof item.content !== "string" || !["pending", "in_progress", "completed", "cancelled", "blocked"].includes(String(item.status)))) return { ok: false, output: "Each todo requires id, content, and a valid status" }
    if (items.filter((item) => item.status === "in_progress").length > 1) return { ok: false, output: "At most one todo may be in_progress" }
    const normalized = items.map((item) => ({ id: String(item.id), content: String(item.content), status: item.status as TodoStatus }))
    context.setTodos?.(normalized)
    const symbol = (status: TodoStatus) => status === "completed" ? "✓" : status === "in_progress" ? "→" : status === "blocked" ? "!" : status === "cancelled" ? "×" : "○"
    return { ok: true, output: normalized.length ? normalized.map((item) => `${symbol(item.status)} ${item.id}: ${item.content}`).join("\n") : "Task plan cleared" }
  },
}

const todoReadTool: ToolImplementation = {
  definition: { type: "function", function: { name: TOOL_NAMES.TODO_READ, description: "Read the current structured task plan.", parameters: toolSchema({}, []) } },
  async execute(_args, context) {
    const items = context.getTodos?.() ?? []
    return { ok: true, output: items.length ? JSON.stringify(items, null, 2) : "No task plan" }
  },
}

export const interactionTools = [memoryListTool, memoryReadTool, memoryWriteTool, memoryDeleteTool, writeTaskNoteTool, enterPlanModeTool, exitPlanModeTool, askUserTool, todoWriteTool, todoReadTool] satisfies ToolImplementation[]
