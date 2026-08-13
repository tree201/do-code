import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { runAgent } from "../src/agent.js"
import { runAgentSession } from "../src/session.js"
import { PolicyEngine } from "../src/policy.js"
import { contentText, type AgentEvent, type ChatModel, type ToolDefinition } from "../src/protocol.js"
import { appendRecoveryContinuation, clampOutputTokens, nextToolLoopState } from "../src/agent-recovery.js"
import { emptyReplyFailure, emptyReplyInstruction } from "../src/agent-empty-recovery.js"
import { estimateMessages } from "../src/agent-context.js"

function externalTool(name: string): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description: `Test tool ${name}`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  }
}

test("message estimation caches unchanged message objects", () => {
  let serializations = 0
  const message = {
    role: "user",
    content: "cached",
    toJSON() { serializations++; return { role: "user", content: "cached" } },
  } as never
  assert.equal(estimateMessages([message]), estimateMessages([message]))
  assert.equal(serializations, 1)
})

test("external tools pass through policy, approval, hooks, and ordered agent events", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-agent-contract-"))
  const events: AgentEvent[] = []
  const hookCalls: string[] = []
  const model: ChatModel = {
    async complete(input) {
      if (input.messages.some((message) => contentText(message.content).includes("lookup result"))) {
        return { content: "Finished with external data.", toolCalls: [] }
      }
      return {
        content: null,
        toolCalls: [{
          id: "lookup-1",
          type: "function",
          function: { name: "lookup", arguments: "{}" },
        }],
      }
    },
  }

  const answer = await runAgent("use the external lookup", {
    workspace,
    model,
    policy: new PolicyEngine(workspace, "ask", [{ id: "require-lookup-approval", tool: "lookup", decision: "ask", source: "system" }]),
    approveShell: async () => false,
    approveTool: async (request) => {
      assert.equal(request.tool, "lookup")
      return "once"
    },
    beforeTool: async (name, args) => {
      hookCalls.push(`before:${name}:${JSON.stringify(args)}`)
      return "lookup hook context"
    },
    afterTool: async (name, args, result) => {
      hookCalls.push(`after:${name}:${JSON.stringify(args)}:${result.output}`)
    },
    onEvent: (event) => events.push(event),
    externalTools: [{
      definition: externalTool("lookup"),
      async execute(_args, context) {
        assert.equal(context.workspace, workspace)
        return { ok: true, output: "lookup result" }
      },
    }],
  })

  assert.equal(answer, "Finished with external data.")
  assert.deepEqual(hookCalls, [
    "before:lookup:{}",
    "after:lookup:{}:lookup result",
  ])
  const eventTypes = events.map((event) => event.type)
  assert.deepEqual(eventTypes, [
    "turn.started",
    "step.started",
    "tool.started",
    "policy.decision",
    "approval.requested",
    "approval.resolved",
    "tool.completed",
    "step.started",
    "turn.completed",
  ])
  const policy = events.find((event): event is Extract<AgentEvent, { type: "policy.decision" }> => event.type === "policy.decision")
  assert.equal(policy?.decision, "ask")
  const approval = events.find((event): event is Extract<AgentEvent, { type: "approval.resolved" }> => event.type === "approval.resolved")
  assert.deepEqual({ approved: approval?.approved, choice: approval?.choice }, { approved: true, choice: "once" })
  assert.ok(events.every((event) => event.protocolVersion === 1 && event.turnId === events[0]?.turnId))
})

test("external tool execution receives cancellation and emits an aborted turn failure", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-agent-cancel-contract-"))
  const controller = new AbortController()
  const events: AgentEvent[] = []
  let executeStarted!: () => void
  const started = new Promise<void>((resolve) => { executeStarted = resolve })
  const model: ChatModel = {
    async complete() {
      return {
        content: null,
        toolCalls: [{ id: "wait-1", type: "function", function: { name: "wait_for_signal", arguments: "{}" } }],
      }
    },
  }

  const running = runAgent("wait", {
    workspace,
    model,
    signal: controller.signal,
    approveShell: async () => false,
    onEvent: (event) => {
      events.push(event)
      if (event.type === "tool.started") executeStarted()
    },
    externalTools: [{
      definition: externalTool("wait_for_signal"),
      async execute(_args, context) {
        await new Promise<void>((resolve, reject) => {
          if (context.signal?.aborted) return reject(new DOMException("Aborted", "AbortError"))
          context.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
          void resolve
        })
        return { ok: true, output: "unexpected" }
      },
    }],
  })

  await started
  controller.abort()
  await assert.rejects(running, (error: unknown) => error instanceof Error && error.name === "AbortError")
  const failed = events.at(-1)
  assert.equal(failed?.type, "turn.failed")
  if (failed?.type === "turn.failed") assert.equal(failed.aborted, true)
})

test("agent tool visibility preserves registry order and applies allow, deny, and plan guards", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-tool-visibility-contract-"))
  const requests: string[][] = []
  const external = {
    definition: { type: "function" as const, function: { name: "external_check", description: "Check", parameters: { type: "object" as const, properties: {}, additionalProperties: false } } },
    execute: async () => ({ ok: true, output: "checked" }),
  }
  const model: ChatModel = {
    async complete(input) {
      requests.push(input.tools.map((tool) => tool.function.name))
      return { content: "visible", toolCalls: [] }
    },
  }

  await runAgentSession("inspect", {
    workspace,
    model,
    approveShell: async () => false,
    externalTools: [external],
    toolAllowList: ["read_file", "external_check", "enter_plan_mode", "exit_plan_mode"],
  })
  assert.deepEqual(requests[0], ["read_file", "external_check"])

  requests.length = 0
  await runAgentSession("inspect", {
    workspace,
    model,
    approveShell: async () => false,
    externalTools: [external],
    toolAllowList: ["read_file", "external_check"],
    toolDenyList: ["external_check"],
    enterPlanMode: async () => "ask",
    publishPlan: () => {},
  })
  assert.deepEqual(requests[0], ["read_file"])

  requests.length = 0
  await runAgentSession("inspect", {
    workspace,
    model,
    approveShell: async () => false,
    toolAllowList: ["enter_plan_mode", "exit_plan_mode"],
    enterPlanMode: async () => "ask",
  })
  assert.deepEqual(requests[0], [])
})

test("agent recovery contract bounds output, merges overlap, and detects repeated tool calls", () => {
  assert.equal(clampOutputTokens(64_000, 128_000, 10_000), 64_000)
  assert.equal(clampOutputTokens(64_000, 20_000, 18_000), 4_000)
  assert.equal(appendRecoveryContinuation("one shared suffix", "shared suffix two"), "one shared suffix two")
  const first = nextToolLoopState({ signature: null, count: 0 }, "read_file", "{}")
  const second = nextToolLoopState(first.state, "read_file", "{}")
  assert.equal(first.repeated, false)
  assert.equal(second.state.count, 2)
  assert.equal(second.repeated, false)
})

test("agent empty-reply recovery keeps targeted retry and failure messages stable", () => {
  assert.match(emptyReplyInstruction("stop", true), /contained reasoning but no actionable output/)
  assert.match(emptyReplyInstruction("length", false), /finish_reason: length/)
  assert.match(emptyReplyFailure("max_tokens", false), /output token limit/)
  assert.match(emptyReplyFailure("stop", true), /returned reasoning but no tool call/)
  assert.match(emptyReplyFailure("stop", false), /neither tool calls nor a final answer/)
})
