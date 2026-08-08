import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { parseArgs } from "../src/cli-args.js"
import { EXIT_CODES, exitCodeForResult, streamEnvelope } from "../src/headless.js"
import { runAgentSession, type AgentRunResult } from "../src/session.js"
import type { ChatModel } from "../src/protocol.js"

function failed(stopReason: AgentRunResult["stopReason"]): AgentRunResult {
  return { status: "failed", stopReason, finalAnswer: null, patch: "", steps: 1, toolCalls: 0, durationMs: 1, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0 }, events: [], errorMessage: stopReason }
}

test("headless flags accept stdin-only runs and expose stable exit codes", () => {
  const args = parseArgs(["run", "--output-format", "stream-json", "--timeout", "12"])
  assert.equal(args.outputFormat, "stream-json")
  assert.equal(args.timeoutSeconds, 12)
  assert.equal(exitCodeForResult(failed("model_error")), EXIT_CODES.model)
  assert.equal(exitCodeForResult(failed("max_steps")), EXIT_CODES.maxSteps)
  assert.equal(exitCodeForResult(failed("timeout")), EXIT_CODES.timeout)
  assert.equal(streamEnvelope("run-1", 0, "system.init", {}).protocolVersion, 1)
})

test("headless session reports Qwen-style task turn exhaustion as max_steps", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-max-turns-"))
  const model: ChatModel = {
    async complete() {
      return {
        content: null,
        toolCalls: [{
          id: "keep-going",
          type: "function",
          function: { name: "read_file", arguments: JSON.stringify({ path: "missing.txt" }) },
        }],
      }
    },
  }

  const result = await runAgentSession("keep working", {
    workspace,
    model,
    approveShell: async () => false,
    maxSteps: 1,
  })

  assert.equal(result.status, "failed")
  assert.equal(result.stopReason, "max_steps")
  assert.equal(exitCodeForResult(result), EXIT_CODES.maxSteps)
})

test("agent session freezes safe config, records usage, and enforces timeout", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-headless-"))
  const artifacts = path.join(workspace, "artifacts")
  const model: ChatModel = { async complete() { return { content: "done", toolCalls: [], usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 3 } } } }
  const result = await runAgentSession("finish", { workspace, model, approveShell: async () => false, artifactDirectory: artifacts, frozenConfig: { model: "fake", approvalMode: "full-access" } })
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 2, cachedTokens: 3, requests: 1 })
  assert.deepEqual(JSON.parse(await readFile(path.join(artifacts, "run-config.json"), "utf8")), { model: "fake", approvalMode: "full-access" })
  assert.equal(JSON.parse((await readFile(path.join(artifacts, "events.jsonl"), "utf8")).trim().split("\n")[0]!).protocolVersion, 1)

  const waiting: ChatModel = { async complete(_input, options) { return await new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true })) } }
  const timeout = await runAgentSession("wait", { workspace, model: waiting, approveShell: async () => false, timeoutMs: 10 })
  assert.equal(timeout.stopReason, "timeout")
  assert.equal(exitCodeForResult(timeout), EXIT_CODES.timeout)
})

test("session timeout interrupts an active shell tool", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-shell-timeout-"))
  let turn = 0
  const model: ChatModel = { async complete() {
    turn++
    if (turn === 1) return { content: null, toolCalls: [{ id: "slow", type: "function", function: { name: "shell", arguments: JSON.stringify({ command: "sleep 5" }) } }] }
    return { content: "unexpected", toolCalls: [] }
  } }
  const started = Date.now()
  const result = await runAgentSession("wait", { workspace, model, approveShell: async () => true, timeoutMs: 30 })
  assert.equal(result.stopReason, "timeout")
  assert.ok(Date.now() - started < 1_000)
})

test("non-TTY stdin produces a clean init/event/result JSONL stream", async () => {
  let requestBody = ""
  const server = createServer((request, response) => {
    request.on("data", (chunk) => { requestBody += chunk.toString() })
    request.on("end", () => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ choices: [{ message: { content: "stdin complete", tool_calls: [] } }], usage: { prompt_tokens: 7, completion_tokens: 2 } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-cli-"))
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "--output-format", "stream-json", "--yes", "--cwd", workspace], {
    cwd: path.resolve("."),
    env: { ...process.env, MODEL_API_KEY: "must-not-leak", MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`, MODEL_ID: "fake-model" },
    stdio: ["pipe", "pipe", "pipe"],
  })
  child.stdin.end("来自 stdin 的任务")
  let output = "", diagnostics = ""
  child.stdout.on("data", (chunk) => { output += chunk.toString() })
  child.stderr.on("data", (chunk) => { diagnostics += chunk.toString() })
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve))
  server.close()
  assert.equal(code, 0, diagnostics)
  const lines = output.trim().split("\n").map((line) => JSON.parse(line) as { type: string; protocolVersion: number; data: Record<string, unknown> })
  assert.equal(lines[0]?.type, "system.init")
  assert.equal(lines.at(-1)?.type, "result")
  assert.ok(lines.every((line) => line.protocolVersion === 1))
  assert.match(requestBody, /来自 stdin 的任务/)
  assert.doesNotMatch(output, /must-not-leak/)
})
