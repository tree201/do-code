import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { AgentConversation } from "../src/agent.js"
import { writeDurableMemory } from "../src/durable-memory.js"
import type { ChatModel } from "../src/protocol.js"

async function withMemoryData<T>(run: (workspace: string) => Promise<T>) {
  const previous = process.env.DO_CODE_DATA_DIR
  process.env.DO_CODE_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "do-code-memory-data-"))
  try {
    return await run(await mkdtemp(path.join(os.tmpdir(), "do-code-memory-workspace-")))
  } finally {
    if (previous === undefined) delete process.env.DO_CODE_DATA_DIR
    else process.env.DO_CODE_DATA_DIR = previous
  }
}

test("relevant user memory is injected before the task reaches the model", async () => {
  await withMemoryData(async (workspace) => {
    await writeDurableMemory(workspace, {
      scope: "user", type: "feedback", name: "design-first", description: "Discuss design before implementation.",
      content: "Discuss design before implementation.\n\n**Why:** It avoids speculative work.\n\n**How to apply:** Present options before editing.",
    })
    const model: ChatModel = {
      async complete(input) {
        const system = String(input.messages[0]?.content)
        assert.match(system, /feedback\/design-first\.md/)
        assert.match(system, /## Relevant memory/)
        assert.match(system, /Present options before editing/)
        return { content: "Discussed options", toolCalls: [] }
      },
    }
    const conversation = new AgentConversation({ workspace, model, approveShell: async () => false })
    await conversation.run("Add a new feature; discuss the design first.")
  })
})

test("automatic memory writes refresh the next task's index and recall", async () => {
  await withMemoryData(async (workspace) => {
    let calls = 0
    const model: ChatModel = {
      async complete(input) {
        calls += 1
        const system = String(input.messages[0]?.content)
        if (calls === 1) {
          assert.match(system, /Your MEMORY\.md is currently empty/)
          return {
            content: "",
            toolCalls: [{ id: "memory-1", type: "function", function: { name: "memory_write", arguments: JSON.stringify({
              scope: "user", type: "feedback", name: "terse-responses", description: "User prefers concise replies.",
              content: "The user prefers concise replies.\n\n**Why:** They asked for direct answers.\n\n**How to apply:** Avoid trailing summaries.",
            }) } }],
          }
        }
        if (calls === 2) return { content: "Saved", toolCalls: [] }
        assert.match(system, /User prefers concise replies/)
        assert.match(system, /Avoid trailing summaries/)
        return { content: "Applied", toolCalls: [] }
      },
    }
    const conversation = new AgentConversation({ workspace, model, approveShell: async () => false })
    await conversation.run("Remember that I prefer concise replies.")
    await conversation.run("Use concise replies for this task.")
    assert.equal(calls, 3)
  })
})
