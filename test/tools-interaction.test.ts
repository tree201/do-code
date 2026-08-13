import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { executeTool } from "../src/tools.js"

test("ask_user and todo tools expose structured interaction state", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-interaction-tools-"))
  let todos: Array<{ id: string; content: string; status: "pending" | "in_progress" | "completed" | "cancelled" | "blocked" }> = []
  const context = { workspace, approveShell: async () => false, askUser: async () => "Option B", getTodos: () => todos, setTodos: (items: typeof todos) => { todos = items } }
  const question = await executeTool("ask_user", { questions: [{ id: "choice", header: "Choice", question: "Choose", options: [{ label: "Option A", description: "First" }, { label: "Option B", description: "Second" }] }] }, context)
  assert.match(question.output, /Option B/)
  const written = await executeTool("todo_write", { items: [{ id: "1", content: "Implement", status: "in_progress" }] }, context)
  assert.equal(written.ok, true)
  const read = await executeTool("todo_read", {}, context)
  assert.match(read.output, /Implement/)
})

test("delegate task receives the active turn signal", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-delegate-signal-"))
  const controller = new AbortController()
  let received: AbortSignal | undefined
  const result = await executeTool("delegate_task", { task: "Inspect rendering" }, {
    workspace,
    signal: controller.signal,
    approveShell: async () => false,
    delegateTask: async (_task, signal) => { received = signal; return "done" },
  })
  assert.equal(result.ok, true)
  assert.strictEqual(received, controller.signal)
})

test("plan tools enter read-only planning and publish without a blocking review", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-plan-tools-"))
  let enteredReason = ""
  let publishedTitle = ""
  const context = {
    workspace,
    approveShell: async () => false,
    enterPlanMode: async (reason: string) => { enteredReason = reason; return "auto" as const },
    publishPlan: (plan: { title: string }) => { publishedTitle = plan.title },
  }
  const entered = await executeTool("enter_plan_mode", { reason: "Cross-cutting refactor" }, context)
  assert.equal(entered.ok, true)
  assert.equal(enteredReason, "Cross-cutting refactor")
  assert.match(entered.output, /Approval mode remains auto/)

  const published = await executeTool("exit_plan_mode", {
    title: "Refactor authentication",
    summary: "Separate policy from transport.",
    steps: ["Extract policy", "Update callers"],
    files: ["src/auth.ts"],
    verification: ["npm test"],
    risks: ["Session compatibility"],
  }, context)
  assert.equal(published.ok, true)
  assert.equal(publishedTitle, "Refactor authentication")
  assert.match(published.output, /Remain in read-only Plan mode/)
})

test("plan interaction blocks mutations without changing the execution approval mode", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-plan-policy-"))
  const context = {
    workspace,
    approveShell: async () => false,
    approvalMode: "full-access" as const,
    isPlanMode: () => true,
  }
  const blocked = await executeTool("write_file", { path: "blocked.txt", content: "no" }, context)
  assert.equal(blocked.ok, false)
  assert.match(blocked.output, /Plan mode blocks write_file/)

  const readable = await executeTool("list_directory", { path: "." }, context)
  assert.equal(readable.ok, true)
  assert.equal(context.approvalMode, "full-access")
})
