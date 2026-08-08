import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { AgentConversation, runAgent } from "../src/agent.js"
import { InstructionMemory } from "../src/instructions.js"
import { parseArgs } from "../src/cli-args.js"
import { runAgentSession } from "../src/session.js"
import { contentText, type AgentEvent, type ChatModel, type Message } from "../src/protocol.js"

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

test("agent advertises proactive plan transitions and explains the approval workflow", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-agent-plan-prompt-"))
  const model: ChatModel = {
    async complete(input) {
      const prompt = contentText(input.messages[0]?.content)
      assert.match(prompt, /proactively call enter_plan_mode/)
      assert.match(prompt, /exit_plan_mode performs the formal approval interaction/)
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
    reviewPlan: async () => "cancel",
  }), "Ready.")
})

test("agent stops five consecutive identical tool calls like Qwen Code", async () => {
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

test("CLI defaults to Qwen Code's 100-turn task budget", () => {
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

test("agent preserves reasoning across tool turns", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-reasoning-"))
  let turn = 0
  const model: ChatModel = {
    async complete(input) {
      turn++
      if (turn === 1) return {
        content: null,
        reasoningContent: "Need to inspect the workspace.",
        finishReason: "tool_calls",
        toolCalls: [{ id: "list", type: "function", function: { name: "list_directory", arguments: JSON.stringify({ path: "." }) } }],
      }
      const assistant = input.messages.find((message) => message.role === "assistant")
      assert.equal(assistant?.role === "assistant" ? assistant.reasoning_content : null, "Need to inspect the workspace.")
      return { content: "Finished.", finishReason: "stop", toolCalls: [] }
    },
  }

  assert.equal(await runAgent("inspect", { workspace, model, approveShell: async () => false }), "Finished.")
})

test("agent gives a targeted retry after a reasoning-only response", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-reasoning-only-"))
  let turn = 0
  const model: ChatModel = {
    async complete(input) {
      turn++
      if (turn === 1) return { content: null, reasoningContent: "Still considering.", finishReason: "stop", toolCalls: [] }
      assert.match(contentText(input.messages.at(-1)?.content), /contained reasoning but no actionable output/)
      return { content: "Recovered.", finishReason: "stop", toolCalls: [] }
    },
  }

  assert.equal(await runAgent("finish", { workspace, model, approveShell: async () => false }), "Recovered.")
})

test("agent continues a MAX_TOKENS reasoning-only response with an escalated output budget", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-output-recovery-"))
  const budgets: Array<number | undefined> = []
  let turn = 0
  const model: ChatModel = {
    async complete(input, options) {
      budgets.push(options?.maxOutputTokens)
      turn++
      if (turn === 1) return { content: null, reasoningContent: "Inspect the source before editing.", finishReason: "length", toolCalls: [] }
      if (turn === 2) {
        assert.equal(input.messages.at(-2)?.role, "assistant")
        assert.equal(input.messages.at(-1)?.role, "user")
        assert.match(contentText(input.messages.at(-1)?.content), /Resume directly/)
        return {
          content: null,
          finishReason: "tool_calls",
          toolCalls: [{ id: "write", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "recovered.txt", content: "ok\n" }) } }],
        }
      }
      return { content: "Recovered and finished.", finishReason: "stop", toolCalls: [] }
    },
  }

  const conversation = new AgentConversation({ workspace, model, approveShell: async () => false, contextWindow: 128_000 })
  assert.equal(await conversation.run("implement the change"), "Recovered and finished.")
  assert.deepEqual(budgets, [32_000, 64_000, 32_000])
  assert.equal(await readFile(path.join(workspace, "recovered.txt"), "utf8"), "ok\n")
  assert.ok(!conversation.history().some((message) => contentText(message.content).includes("Output token limit hit")))
})

test("agent merges and de-duplicates MAX_TOKENS text continuations", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-output-merge-"))
  let turn = 0
  const model: ChatModel = {
    async complete() {
      turn++
      if (turn === 1) return { content: "Completed section one.\nShared continuation anchor.", finishReason: "length", toolCalls: [] }
      return { content: "Shared continuation anchor.\nCompleted section two.", finishReason: "stop", toolCalls: [] }
    },
  }
  const conversation = new AgentConversation({ workspace, model, approveShell: async () => false })
  assert.equal(await conversation.run("write a long answer"), "Completed section one.\nShared continuation anchor.\nCompleted section two.")
  assert.equal(conversation.history().filter((message) => message.role === "assistant").length, 1)
})

test("agent stops after three MAX_TOKENS continuation attempts", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-output-exhausted-"))
  let calls = 0
  const model: ChatModel = {
    async complete() {
      calls++
      return { content: `partial-${calls}\n`, reasoningContent: `thought-${calls}`, finishReason: "length", toolCalls: [] }
    },
  }
  await assert.rejects(
    () => runAgent("finish a long task", { workspace, model, approveShell: async () => false }),
    /after 3 continuation attempts/,
  )
  assert.equal(calls, 4)
})

test("conversation preserves earlier turns for follow-up requests", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-conversation-"))
  const requests: Message[][] = []
  const model: ChatModel = {
    async complete(input) {
      requests.push([...input.messages])
      const users = input.messages.filter((message) => message.role === "user")
      return { content: `answer-${users.length}`, toolCalls: [] }
    },
  }
  const conversation = new AgentConversation({ workspace, model, approveShell: async () => false })

  assert.equal(await conversation.run("first request"), "answer-1")
  assert.equal(await conversation.run("follow-up request"), "answer-2")
  assert.deepEqual(requests[1]?.map((message) => message.role), ["system", "user", "assistant", "user"])
  assert.equal(conversation.history().at(-1)?.role, "assistant")
})

test("conversation refreshes output-language instructions without losing history", async () => {
  const workspace=await mkdtemp(path.join(os.tmpdir(),"do-code-language-instruction-"))
  let turn=0
  const model:ChatModel={async complete(input){
    turn++
    const system=contentText(input.messages[0]?.content)
    if(turn===1)assert.match(system,/Respond in English/)
    else{
      assert.match(system,/Respond in Simplified Chinese/)
      assert.ok(input.messages.some((message)=>message.role==="assistant"&&message.content==="first"))
    }
    return {content:turn===1?"first":"第二次",toolCalls:[]}
  }}
  const conversation=new AgentConversation({workspace,model,approveShell:async()=>false,profileInstructions:"Respond in English"})
  await conversation.run("first turn")
  await conversation.setProfileInstructions("Respond in Simplified Chinese")
  assert.equal(await conversation.run("第二轮"),"第二次")
})

test("manual compaction preserves a continuation summary and records usage", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-compact-"))
  let calls = 0
  const model: ChatModel = {
    async complete(input) {
      calls++
      if (input.tools.length === 0) return { content: "Goal: finish feature. Changed: src/a.ts. Tests: pending.", toolCalls: [], usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 5 } }
      return { content: "Initial answer", toolCalls: [], usage: { inputTokens: 10, outputTokens: 3, cachedTokens: 0 } }
    },
  }
  const conversation = new AgentConversation({ workspace, model, approveShell: async () => false, instructionMemory: new InstructionMemory(workspace, null) })
  await conversation.run("implement feature")
  assert.equal(await conversation.compact(), true)
  assert.equal(conversation.history().length, 2)
  assert.match(contentText(conversation.history()[1]?.content), /Changed: src\/a\.ts/)
  assert.equal(conversation.stats().compactions, 1)
  assert.equal(conversation.stats().requests, 2)
  assert.equal(calls, 2)
})

test("automatically compacts an oversized restored conversation before the next request", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-auto-compact-"))
  let compactCalls = 0
  const model: ChatModel = {
    async complete(input) {
      if (input.tools.length === 0) {
        compactCalls++
        return { content: "Preserved goal and verification state.", toolCalls: [] }
      }
      assert.ok(input.messages.length <= 3)
      return { content: "Continued", toolCalls: [] }
    },
  }
  const conversation = new AgentConversation({ workspace, model, approveShell: async () => false, contextWindow: 100, instructionMemory: new InstructionMemory(workspace, null) })
  conversation.restore([
    { role: "system", content: "system" },
    ...Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: "x".repeat(100) })),
  ])
  assert.equal(await conversation.run("continue"), "Continued")
  assert.equal(compactCalls, 1)
  assert.equal(conversation.stats().compactions, 1)
})

test("agent emits versioned streaming events in order", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-events-"))
  const events: AgentEvent[] = []
  const model: ChatModel = {
    async complete(_input, options) {
      options?.onReasoningDelta?.("considering")
      options?.onContentDelta?.("streamed ")
      options?.onContentDelta?.("answer")
      return { content: "streamed answer", toolCalls: [] }
    },
  }

  const answer = await runAgent("respond", {
    workspace,
    model,
    approveShell: async () => false,
    onEvent: (event) => events.push(event),
  })

  assert.equal(answer, "streamed answer")
  assert.deepEqual(events.map((event) => event.type), [
    "turn.started",
    "step.started",
    "reasoning.delta",
    "message.delta",
    "message.delta",
    "turn.completed",
  ])
  assert.ok(events.every((event) => event.protocolVersion === 1))
  assert.equal(new Set(events.map((event) => event.turnId)).size, 1)
  const reasoning = events.find((event): event is Extract<AgentEvent, { type: "reasoning.delta" }> => event.type === "reasoning.delta")
  assert.equal(reasoning?.totalCharacters, "considering".length)
})

test("agent suppresses provisional text when the same model step calls a tool", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-tool-narration-"))
  const events: AgentEvent[] = []
  let turn = 0
  const model: ChatModel = {
    async complete(_input, options) {
      turn++
      if (turn === 1) {
        options?.onContentDelta?.("I will inspect the workspace first.")
        return {
          content: "I will inspect the workspace first.",
          toolCalls: [{ id: "list-1", type: "function", function: { name: "list_directory", arguments: JSON.stringify({ path: "." }) } }],
        }
      }
      options?.onContentDelta?.("Inspection complete.")
      return { content: "Inspection complete.", toolCalls: [] }
    },
  }

  assert.equal(await runAgent("inspect", {
    workspace,
    model,
    approveShell: async () => false,
    onEvent: (event) => events.push(event),
  }), "Inspection complete.")

  const visibleText = events
    .filter((event): event is Extract<AgentEvent, { type: "message.delta" }> => event.type === "message.delta")
    .map((event) => event.delta)
    .join("")
  assert.equal(visibleText, "Inspection complete.")
  assert.deepEqual(events.map((event) => event.type), [
    "turn.started",
    "step.started",
    "tool.started",
    "tool.completed",
    "step.started",
    "message.delta",
    "turn.completed",
  ])
})

test("agent aborts an in-flight model request and emits turn.failed", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-abort-"))
  const events: AgentEvent[] = []
  const controller = new AbortController()
  const model: ChatModel = {
    async complete(_input, options) {
      return await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
      })
    },
  }
  const running = runAgent("wait", {
    workspace,
    model,
    signal: controller.signal,
    approveShell: async () => false,
    onEvent: (event) => events.push(event),
  })
  controller.abort()

  await assert.rejects(running, (error: unknown) => error instanceof Error && error.name === "AbortError")
  const failed = events.at(-1)
  assert.equal(failed?.type, "turn.failed")
  if (failed?.type === "turn.failed") assert.equal(failed.aborted, true)
})

test("run CLI accepts a task file and external artifact directory", () => {
  const args = parseArgs([
    "run",
    "--task-file",
    "task.md",
    "--artifact-dir",
    "artifacts",
    "--json",
    "--yes",
    "--cwd",
    "workspace",
  ])

  assert.equal(args.command, "run")
  assert.equal(args.taskFile, path.resolve("task.md"))
  assert.equal(args.artifactDirectory, path.resolve("artifacts"))
  assert.equal(args.workspace, path.resolve("workspace"))
  assert.equal(args.yes, true)
  assert.equal(args.json, true)
})

test("agent session patch includes newly created files", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-patch-"))
  const run = promisify(execFile)
  await run("git", ["init", "-q"], { cwd: workspace })
  await run("git", ["config", "user.email", "test@do-code.local"], { cwd: workspace })
  await run("git", ["config", "user.name", "do-code test"], { cwd: workspace })
  await run("git", ["commit", "--allow-empty", "-qm", "baseline"], { cwd: workspace })
  let turn = 0
  const model: ChatModel = {
    async complete() {
      turn++
      if (turn === 1) {
        return {
          content: null,
          toolCalls: [{
            id: "call-new-file",
            type: "function",
            function: { name: "write_file", arguments: JSON.stringify({ path: "new-file.txt", content: "new\n" }) },
          }],
        }
      }
      return { content: "Created the file.", toolCalls: [] }
    },
  }

  const result = await runAgentSession("create a new file", {
    workspace,
    model,
    approveShell: async () => true,
  })

  assert.match(result.patch, /new file mode/)
  assert.match(result.patch, /new-file\.txt/)
  assert.match(result.patch, /\+new/)
})
