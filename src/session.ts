import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { runAgent, type AgentEvent, type AgentOptions } from "./agent.js"
import { completionVerification, verificationCommand, type CompletionVerification, type VerificationCommand } from "./completion-verification.js"
import { captureWorkspaceBaseline, workspacePatchSinceBaseline, type WorkspaceBaseline } from "./workspace-baseline.js"

export type AgentTraceEvent = {
  protocolVersion: 1
  sequence: number
  createdAt: string
  type: "step.started" | "message.delta" | "reasoning.delta" | "tool.started" | "tool.delta" | "tool.completed" | "policy.decision" | "approval.requested" | "approval.resolved" | "agent.completed" | "agent.failed"
  step?: number
  tool?: string
  args?: unknown
  ok?: boolean
  output?: string
  characters?: number
  totalCharacters?: number
  message?: string
  approved?: boolean
  decision?: "allow" | "ask" | "deny"
  risk?: "low" | "medium" | "high" | "critical"
  reason?: string
  matchedRule?: string
  choice?: "deny" | "once" | "session" | "always"
}

export type AgentRunResult = {
  status: "completed" | "failed"
  stopReason: "final_answer" | "max_steps" | "tool_loop" | "model_error" | "tool_error" | "timeout" | "interrupted" | "unknown_error"
  finalAnswer: string | null
  patch: string
  steps: number
  toolCalls: number
  durationMs: number
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number; requests: number }
  events: AgentTraceEvent[]
  errorMessage: string | null
  baseline?: WorkspaceBaseline
  verification?: CompletionVerification
}

export type AgentSessionOptions = Omit<AgentOptions, "onEvent"> & {
  artifactDirectory?: string
  onEvent?: (event: AgentTraceEvent) => void
  timeoutMs?: number
  frozenConfig?: Record<string, unknown>
}

async function commandOutput(command: string, args: string[], cwd: string) {
  return await new Promise<string>((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.on("error", () => resolve(""))
    child.on("close", (code) => resolve(code === 0 ? output : ""))
  })
}

async function workspacePatch(workspace: string) {
  const untracked = (await commandOutput("git", ["ls-files", "--others", "--exclude-standard", "-z"], workspace))
    .split("\0")
    .filter(Boolean)
  if (untracked.length) await commandOutput("git", ["add", "-N", "--", ...untracked], workspace)
  const patch = await commandOutput("git", ["diff", "HEAD", "--binary", "--no-ext-diff", "--", "."], workspace)
  if (untracked.length) await commandOutput("git", ["reset", "-q", "--", ...untracked], workspace)
  return patch
}

function stopReason(error: Error): AgentRunResult["stopReason"] {
  if (error.name === "MaxSessionTurnsError" || error.message.includes("max session turns") || error.message.includes("maximum")) return "max_steps"
  if (error.message.includes("repeated tool loop")) return "tool_loop"
  if (error.message.toLowerCase().includes("model")) return "model_error"
  return "unknown_error"
}

export async function runAgentSession(task: string, options: AgentSessionOptions): Promise<AgentRunResult> {
  const started = Date.now()
  const baseline = await captureWorkspaceBaseline(options.workspace)
  const events: AgentTraceEvent[] = []
  let steps = 0
  let toolCalls = 0
  const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0 }
  const verificationCommands: VerificationCommand[] = []
  const pendingVerification = new Map<string, string>()
  const emit = (event: Omit<AgentTraceEvent, "protocolVersion" | "sequence" | "createdAt">) => {
    const trace = { ...event, protocolVersion: 1 as const, sequence: events.length + 1, createdAt: new Date().toISOString() } as AgentTraceEvent
    events.push(trace)
    options.onEvent?.(trace)
  }
  const onAgentEvent = (event: AgentEvent) => {
    if (event.type === "step.started") {
      steps = event.step
      emit({ type: "step.started", step: event.step })
    } else if (event.type === "message.delta") {
      emit({ type: "message.delta", step: event.step, output: event.delta })
    } else if (event.type === "reasoning.delta") {
      emit({ type: "reasoning.delta", step: event.step, characters: event.characters, totalCharacters: event.totalCharacters })
    } else if (event.type === "tool.started") {
      toolCalls += 1
      const command = event.name === "shell" ? verificationCommand(event.args) : null
      if (command) pendingVerification.set(event.callId, command)
      emit({ type: "tool.started", step: steps, tool: event.name, args: event.args })
    } else if (event.type === "tool.delta") {
      emit({ type: "tool.delta", step: steps, tool: event.name, output: event.delta })
    } else if (event.type === "tool.completed") {
      const command = pendingVerification.get(event.callId)
      if (command) {
        verificationCommands.push({ command, ok: event.ok, output: event.output.slice(-20_000) })
        pendingVerification.delete(event.callId)
      }
      emit({ type: "tool.completed", step: steps, tool: event.name, ok: event.ok, output: event.output })
    } else if (event.type === "policy.decision") {
      emit({ type: "policy.decision", step: steps, tool: event.name, decision: event.decision, risk: event.risk, reason: event.reason, ...(event.matchedRule ? { matchedRule: event.matchedRule } : {}) })
    } else if (event.type === "approval.requested") {
      emit({ type: "approval.requested", step: steps, tool: event.name, output: `${event.title}\n${event.detail}`, risk: event.risk, reason: event.reason, ...(event.matchedRule ? { matchedRule: event.matchedRule } : {}) })
    } else if (event.type === "approval.resolved") {
      emit({ type: "approval.resolved", step: steps, tool: event.name, approved: event.approved, ...(event.choice ? { choice: event.choice } : {}) })
    }
  }

  let status: AgentRunResult["status"] = "completed"
  let reason: AgentRunResult["stopReason"] = "final_answer"
  let finalAnswer: string | null = null
  let errorMessage: string | null = null
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abortFromCaller()
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true })
  const timer = options.timeoutMs ? setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException("Agent run timed out", "AbortError"))
  }, options.timeoutMs) : undefined
  try {
    const { artifactDirectory: _artifactDirectory, frozenConfig: _frozenConfig, timeoutMs: _timeoutMs, ...agentOptions } = options
    finalAnswer = await runAgent(task, {
      ...agentOptions,
      signal: controller.signal,
      onEvent: onAgentEvent,
      onModelUsage: (value) => {
        usage.inputTokens += value.inputTokens
        usage.outputTokens += value.outputTokens
        usage.cachedTokens += value.cachedTokens
        usage.requests += 1
        options.onModelUsage?.(value)
      },
    })
    emit({ type: "agent.completed", message: finalAnswer })
  } catch (error) {
    const value = error instanceof Error ? error : new Error(String(error))
    status = "failed"
    reason = timedOut ? "timeout" : options.signal?.aborted ? "interrupted" : stopReason(value)
    errorMessage = value.message
    emit({ type: "agent.failed", message: value.message })
  } finally {
    if (timer) clearTimeout(timer)
    options.signal?.removeEventListener("abort", abortFromCaller)
  }

  const isolatedPatch = await workspacePatchSinceBaseline(options.workspace, baseline).catch(() => null)
  const patch = isolatedPatch ?? await workspacePatch(options.workspace)
  const verification = completionVerification(Boolean(patch.trim()), verificationCommands)
  const result: AgentRunResult = {
    status,
    stopReason: reason,
    finalAnswer,
    patch,
    steps,
    toolCalls,
    durationMs: Date.now() - started,
    usage,
    events,
    errorMessage,
    baseline,
    verification,
  }
  if (options.artifactDirectory) {
    await mkdir(options.artifactDirectory, { recursive: true })
    if (options.frozenConfig) await writeFile(path.join(options.artifactDirectory, "run-config.json"), `${JSON.stringify(options.frozenConfig, null, 2)}\n`)
    await writeFile(path.join(options.artifactDirectory, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`)
    await writeFile(path.join(options.artifactDirectory, "patch.diff"), patch)
    await writeFile(path.join(options.artifactDirectory, "agent-result.json"), `${JSON.stringify(result, null, 2)}\n`)
    await writeFile(path.join(options.artifactDirectory, "workspace-baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`)
    await writeFile(path.join(options.artifactDirectory, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`)
  }
  return result
}
