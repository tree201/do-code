import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { runAgent } from "../src/agent.js"
import { InstructionMemory } from "../src/instructions.js"
import { parseArgs } from "../src/cli-args.js"
import { contentText, type AgentEvent, type ChatModel } from "../src/protocol.js"

test("agent executes a tool call and returns the final answer", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-agent-"))
  let turn = 0
  const model: ChatModel = {
    async complete() {
      turn++
      if (turn === 1) {
        return {
          content: null,
          toolCalls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "write_file", arguments: JSON.stringify({ path: "hello.txt", content: "hello\n" }) },
            },
          ],
        }
      }
      return { content: "Created hello.txt.", toolCalls: [] }
    },
  }

  const answer = await runAgent("create hello.txt", {
    workspace,
    model,
    approveShell: async () => false,
  })

  assert.equal(answer, "Created hello.txt.")
  assert.equal(await readFile(path.join(workspace, "hello.txt"), "utf8"), "hello\n")
})

test("agent profiles inject instructions and restrict advertised tools", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-agent-profile-"))
  const model: ChatModel = {
    async complete(input) {
      assert.match(String(input.messages[0]?.content), /Review only; never modify files/)
      assert.deepEqual(input.tools.map((tool) => tool.function.name).sort(), ["glob", "read_file", "search"])
      return { content: "Review complete.", toolCalls: [] }
    },
  }
  assert.equal(await runAgent("review", {
    workspace,
    model,
    approveShell: async () => false,
    profileInstructions: "Review only; never modify files.",
    toolAllowList: ["read_file", "glob", "search"],
  }), "Review complete.")
})

test("agent forwards the active turn signal to delegated tasks", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-agent-delegate-signal-"))
  const controller = new AbortController()
  let turn = 0
  let received: AbortSignal | undefined
  const model: ChatModel = {
    async complete() {
      turn++
      if (turn === 1) return { content: null, toolCalls: [{ id: "delegate-1", type: "function", function: { name: "delegate_task", arguments: JSON.stringify({ task: "Inspect" }) } }] }
      return { content: "Finished.", toolCalls: [] }
    },
  }
  assert.equal(await runAgent("review", {
    workspace,
    model,
    approveShell: async () => false,
    delegateTask: async (_task, signal) => { received = signal; return "Findings" },
    signal: controller.signal,
  }), "Finished.")
  assert.strictEqual(received, controller.signal)
})

test("agent reuses the filtered tool definitions across a multi-step turn", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-agent-tool-cache-"))
  const requests: Array<{ tools: readonly unknown[] }> = []
  let turn = 0
  const externalTool = {
    definition: { type: "function" as const, function: { name: "external_check", description: "Check", parameters: { type: "object" as const, properties: {}, additionalProperties: false } } },
    execute: async () => ({ ok: true, output: "checked" }),
  }
  const model: ChatModel = {
    async complete(input) {
      requests.push(input)
      turn++
      if (turn < 3) return { content: null, toolCalls: [{ id: `check-${turn}`, type: "function" as const, function: { name: "external_check", arguments: "{}" } }] }
      return { content: "Finished.", toolCalls: [] }
    },
  }
  assert.equal(await runAgent("check", { workspace, model, approveShell: async () => false, externalTools: [externalTool], toolAllowList: ["external_check"] }), "Finished.")
  assert.equal(requests.length, 3)
  assert.strictEqual(requests[0]!.tools, requests[1]!.tools)
  assert.strictEqual(requests[1]!.tools, requests[2]!.tools)
  assert.deepEqual(requests[0]!.tools.map((tool: any) => tool.function.name), ["external_check"])
})

test("agent advertises proactive plan transitions without a separate approval workflow", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-agent-plan-prompt-"))
  const model: ChatModel = {
    async complete(input) {
      const prompt = contentText(input.messages[0]?.content)
      assert.match(prompt, /proactively call enter_plan_mode/)
      assert.match(prompt, /exit_plan_mode publishes the plan to the conversation and keeps Plan mode active/)
      const names = input.tools.map((tool) => tool.function.name)
      assert.ok(names.includes("enter_plan_mode"))
      assert.ok(names.includes("exit_plan_mode"))
      return { content: "Ready.", toolCalls: [] }
    },
  }
  assert.equal(await runAgent("Consider a complex refactor", {
    workspace,
    model,
    approveShell: async () => false,
    enterPlanMode: async () => "ask",
    publishPlan: () => {},
  }), "Ready.")
})

test("agent stops five consecutive identical tool calls", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-loop-"))
  let index = 0
  const model: ChatModel = {
    async complete() {
      index++
      return {
        content: null,
        toolCalls: [
          {
            id: `call-${index}`,
            type: "function",
            function: { name: "list_directory", arguments: JSON.stringify({ path: "." }) },
          },
        ],
      }
    },
  }

  await assert.rejects(
    runAgent("loop", { workspace, model, approveShell: async () => false }),
    /Stopped repeated tool loop/,
  )
  assert.equal(index, 5)
})

test("agent default turn budget allows more than thirty model turns", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-turn-budget-"))
  let turn = 0
  const model: ChatModel = {
    async complete() {
      turn++
      if (turn <= 31) return {
        content: null,
        toolCalls: [{
          id: `call-${turn}`,
          type: "function",
          function: { name: "read_file", arguments: JSON.stringify({ path: `missing-${turn}.txt` }) },
        }],
      }
      return { content: "Completed after 31 tool turns.", toolCalls: [] }
    },
  }

  assert.equal(
    await runAgent("long task", { workspace, model, approveShell: async () => false }),
    "Completed after 31 tool turns.",
  )
  assert.equal(turn, 32)
})

test("agent reports a configured maximum as max_turns", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-max-turns-"))
  const events: AgentEvent[] = []
  let turn = 0
  const model: ChatModel = {
    async complete() {
      turn++
      return {
        content: null,
        toolCalls: [{
          id: `call-${turn}`,
          type: "function",
          function: { name: "read_file", arguments: JSON.stringify({ path: `missing-${turn}.txt` }) },
        }],
      }
    },
  }

  await assert.rejects(
    runAgent("bounded task", { workspace, model, maxSteps: 2, approveShell: async () => false, onEvent: (event) => events.push(event) }),
    /Reached max session turns for this task \(2\)/,
  )
  const lastEvent = events.at(-1)
  assert.equal(lastEvent?.type, "turn.failed")
  assert.equal(lastEvent?.type === "turn.failed" ? lastEvent.reason : undefined, "max_turns")
})

test("CLI defaults to a 100-turn task budget", () => {
  assert.equal(parseArgs([]).maxSteps, 100)
})

test("agent injects subdirectory AGENTS.md after a file tool enters that directory", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-agent-memory-"))
  await mkdir(path.join(workspace, "src"), { recursive: true })
  await writeFile(path.join(workspace, "src", "AGENTS.md"), "Always use the feature convention.", "utf8")
  await writeFile(path.join(workspace, "src", "index.ts"), "export {}\n", "utf8")
  let turn = 0
  const model: ChatModel = {
    async complete(input) {
      turn++
      if (turn === 1) {
        return {
          content: null,
          toolCalls: [{ id: "read", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "src/index.ts" }) } }],
        }
      }
      assert.match(contentText(input.messages[0]?.content), /Always use the feature convention/)
      return { content: "Loaded nested instructions.", toolCalls: [] }
    },
  }

  const answer = await runAgent("inspect src", {
    workspace,
    model,
    approveShell: async () => false,
    instructionMemory: new InstructionMemory(workspace, null),
  })
  assert.equal(answer, "Loaded nested instructions.")
})

test("agent retries transient empty model replies", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-empty-reply-"))
  let turn = 0
  const model: ChatModel = {
    async complete() {
      turn++
      if (turn === 1) return { content: null, toolCalls: [] }
      return { content: "Finished after retry.", toolCalls: [] }
    },
  }

  const answer = await runAgent("finish the task", { workspace, model, approveShell: async () => false })
  assert.equal(answer, "Finished after retry.")
  assert.equal(turn, 2)
})

test("agent requires an observed verification command after a mutation", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-verification-gate-"))
  let turn = 0
  const model: ChatModel = {
    async complete(input) {
      turn++
      if (turn === 1) return { content: null, toolCalls: [{ id: "write", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "changed.txt", content: "changed\n" }) } }] }
      if (turn === 2) return { content: "I changed the file.", toolCalls: [] }
      if (turn === 3) {
        assert.match(contentText(input.messages.at(-1)?.content), /Completion gate/)
        return { content: null, toolCalls: [{ id: "verify", type: "function", function: { name: "shell", arguments: JSON.stringify({ command: "node --test --help" }) } }] }
      }
      return { content: "Changed and verified.", toolCalls: [] }
    },
  }
  assert.equal(await runAgent("change and verify", { workspace, model, approveShell: async () => "once", requireVerification: true }), "Changed and verified.")
  assert.equal(turn, 4)
})
