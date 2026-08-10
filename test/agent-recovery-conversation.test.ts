import assert from "node:assert/strict"
import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { AgentConversation, runAgent } from "../src/agent.js"
import { InstructionMemory } from "../src/instructions.js"
import { contentText, type ChatModel, type Message } from "../src/protocol.js"

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
