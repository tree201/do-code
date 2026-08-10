import type { PlanProposal, TodoStatus, ToolImplementation } from "./tool-contracts.js"
import { optionalStringArray, stringArray, toolSchema } from "./tool-definition-helpers.js"
import { text } from "./tool-input.js"
import { TOOL_NAMES } from "./tool-names.js"

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
    description: "Submit the finalized implementation plan for user review. This interaction asks whether to execute, revise, or cancel; do not separately ask whether the plan is approved.",
    parameters: toolSchema({ title: { type: "string" }, summary: { type: "string" }, steps: { type: "array", minItems: 1, items: { type: "string" } }, files: { type: "array", items: { type: "string" } }, verification: { type: "array", items: { type: "string" } }, risks: { type: "array", items: { type: "string" } } }, ["title", "summary", "steps"]),
  } },
  async execute(args, context) {
    if (!context.reviewPlan) return { ok: false, output: "Interactive plan review is unavailable in this run" }
    const proposal: PlanProposal = {
      title: text(args, "title"),
      summary: text(args, "summary"),
      steps: stringArray(args, "steps"),
      files: optionalStringArray(args, "files"),
      verification: optionalStringArray(args, "verification"),
      risks: optionalStringArray(args, "risks"),
    }
    const decision = await context.reviewPlan(proposal)
    if (decision === "execute") return { ok: true, output: "The user approved the plan. Exit planning and implement it now using the approval mode that was already active; do not change permissions." }
    if (decision === "revise") return { ok: true, output: "The user requested changes to the plan. Stay in read-only plan mode, stop this turn, and invite the user to provide feedback before submitting another plan." }
    return { ok: true, output: "The user cancelled this plan. Stop without making changes." }
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

export const interactionTools = [enterPlanModeTool, exitPlanModeTool, askUserTool, todoWriteTool, todoReadTool] satisfies ToolImplementation[]
