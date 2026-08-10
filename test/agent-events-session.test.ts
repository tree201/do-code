import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp } from "node:fs/promises"
import { promisify } from "node:util"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { runAgent } from "../src/agent.js"
import { parseArgs } from "../src/cli-args.js"
import { runAgentSession } from "../src/session.js"
import { type AgentEvent, type ChatModel } from "../src/protocol.js"

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

test("agent preserves streamed text when the same model step calls a tool", async () => {
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
  assert.equal(visibleText, "I will inspect the workspace first.Inspection complete.")
  assert.deepEqual(events.map((event) => event.type), [
    "turn.started",
    "step.started",
    "message.delta",
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
