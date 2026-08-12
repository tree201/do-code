import path from "node:path"
import type { AgentOptions, AgentTurnOptions } from "./agent.js"
import { availableToolDefinitions, toolEnabled } from "./agent-tool-visibility.js"
import { emptyReplyFailure, emptyReplyInstruction } from "./agent-empty-recovery.js"
import {
  appendRecoveryContinuation,
  clampOutputTokens,
  DEFAULT_MAX_OUTPUT_TOKENS,
  ESCALATED_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_RECOVERY_ATTEMPTS,
  nextToolLoopState,
  outputRecoveryMessage,
} from "./agent-recovery.js"
import { recordVerificationNudge, shouldRequestVerification, updateVerificationState, type VerificationState } from "./agent-verification.js"
import { estimateMessages } from "./agent-context.js"
import { expandPromptContent } from "./file-context.js"
import { approvalRequest, approved, planModeRestriction } from "./policy.js"
import { AGENT_EVENT_PROTOCOL_VERSION, type AgentEvent, type AgentEventPayload, type Message, type ModelReply, type ToolCall } from "./protocol.js"
import { executeTool, type ToolContext, type ToolResult } from "./tools.js"
import { DEFAULT_MAX_TURNS, MaxSessionTurnsError } from "./turn-limits.js"

const SHELL_TOOL = "shell"

function parseArguments(call: ToolCall) {
  try {
    return JSON.parse(call.function.arguments) as unknown
  } catch {
    throw new Error(`Invalid JSON arguments for ${call.function.name}`)
  }
}

export async function runAgentTurn(task: string, messages: Message[], options: AgentOptions, turnOptions: AgentTurnOptions = {}) {
  const turnId = `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const emit = (event: AgentEventPayload) => {
    options.onEvent?.({ protocolVersion: AGENT_EVENT_PROTOCOL_VERSION, turnId, ...event } as AgentEvent)
  }
  const signal = turnOptions.signal ?? options.signal
  const attachmentDirectory = typeof options.attachmentDirectory === "function" ? options.attachmentDirectory() : options.attachmentDirectory
  messages.push({ role: "user", content: await expandPromptContent(task, options.workspace, attachmentDirectory) })
  emit({ type: "turn.started", input: turnOptions.displayInput ?? task })
  const maxTurns = options.maxSteps ?? DEFAULT_MAX_TURNS
  let toolLoopState = { signature: null as string | null, count: 0 }
  let emptyReplies = 0
  let verificationState: VerificationState = { unverifiedMutation: false, verificationNudges: 0 }
  const availableTools = availableToolDefinitions(options)

  try {
    for (let step = 1; step <= maxTurns; step++) {
      signal?.throwIfAborted()
      await options.beforeModelRequest?.(messages)
      emit({ type: "step.started", step })
      const recoveryStart = messages.length
      let recoveryAttempts = 0
      let accumulatedContent = ""
      let accumulatedReasoning = ""
      let reasoningCharacters = 0
      let pendingReasoningCharacters = 0
      let lastReasoningEventAt = 0
      let maxOutputTokens = clampOutputTokens(DEFAULT_MAX_OUTPUT_TOKENS, options.contextWindow ?? 128_000, estimateMessages(messages))
      let reply: ModelReply

      while (true) {
        let bufferedDelta = ""
        const isContinuation = recoveryAttempts > 0
        reply = await options.model.complete(
          { messages, tools: availableTools },
          {
            ...(signal ? { signal } : {}),
            ...(attachmentDirectory ? { sessionDirectory: path.dirname(attachmentDirectory) } : {}),
            maxOutputTokens,
            onContentDelta: (delta) => {
              if (!delta) return
              bufferedDelta += delta
              if (!isContinuation) emit({ type: "message.delta", step, delta })
            },
            onReasoningDelta: (delta) => {
              if (!delta) return
              reasoningCharacters += delta.length
              pendingReasoningCharacters += delta.length
              const now = Date.now()
              if (lastReasoningEventAt === 0 || pendingReasoningCharacters >= 256 || now - lastReasoningEventAt >= 250) {
                emit({ type: "reasoning.delta", step, characters: pendingReasoningCharacters, totalCharacters: reasoningCharacters })
                pendingReasoningCharacters = 0
                lastReasoningEventAt = now
              }
            },
            onRetry: (attempt, delayMs, message) => emit({ type: "model.retrying", step, attempt, delayMs, ...(message ? { message } : {}) }),
          },
        ).catch((error) => {
          if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error
          throw new Error(`Model request failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
        })
        if (reply.usage) options.onModelUsage?.(reply.usage)
        if (pendingReasoningCharacters > 0) {
          emit({ type: "reasoning.delta", step, characters: pendingReasoningCharacters, totalCharacters: reasoningCharacters })
          pendingReasoningCharacters = 0
          lastReasoningEventAt = Date.now()
        }

        const truncated = reply.finishReason === "length" || reply.finishReason === "max_tokens"
        if (!truncated || reply.toolCalls.length > 0) break
        if (recoveryAttempts >= MAX_OUTPUT_RECOVERY_ATTEMPTS) {
          throw new Error(`Model exhausted its output token limit after ${MAX_OUTPUT_RECOVERY_ATTEMPTS} continuation attempts (finish_reason: ${reply.finishReason})`)
        }

        accumulatedContent = appendRecoveryContinuation(accumulatedContent, reply.content ?? bufferedDelta)
        accumulatedReasoning = appendRecoveryContinuation(accumulatedReasoning, reply.reasoningContent ?? "")
        messages.push({ role: "assistant", content: reply.content, ...(reply.reasoningContent ? { reasoning_content: reply.reasoningContent } : {}) })
        messages.push({ role: "user", content: outputRecoveryMessage(accumulatedContent) })
        recoveryAttempts++
        maxOutputTokens = clampOutputTokens(ESCALATED_MAX_OUTPUT_TOKENS, options.contextWindow ?? 128_000, estimateMessages(messages))
      }

      if (recoveryAttempts > 0) {
        const content = appendRecoveryContinuation(accumulatedContent, reply.content ?? "")
        const reasoningContent = appendRecoveryContinuation(accumulatedReasoning, reply.reasoningContent ?? "")
        messages.splice(recoveryStart)
        reply = { ...reply, content: content || null, ...(reasoningContent ? { reasoningContent } : {}) }
      }
      if (reply.toolCalls.length === 0) {
        if (!reply.content?.trim()) {
          emptyReplies++
          const reason = reply.finishReason || "unknown"
          const thoughtOnly = Boolean(reply.reasoningContent?.trim())
          if (emptyReplies >= 3) throw new Error(emptyReplyFailure(reason, thoughtOnly))
          messages.push({ role: "user", content: emptyReplyInstruction(reason, thoughtOnly) })
          continue
        }
        if (shouldRequestVerification(verificationState, Boolean(options.requireVerification))) {
          messages.push({ role: "assistant", content: reply.content })
          messages.push({ role: "user", content: "Completion gate: workspace files changed after the last successful verification. Before finishing, run the most relevant test, build, lint, typecheck, or equivalent check. If no automated check is available, explain that explicitly in the final answer." })
          verificationState = recordVerificationNudge(verificationState)
          continue
        }
        if (recoveryAttempts > 0 && reply.content) {
          const continuation = reply.content.startsWith(accumulatedContent) ? reply.content.slice(accumulatedContent.length) : reply.content
          if (continuation) emit({ type: "message.delta", step, delta: continuation })
        }
        messages.push({ role: "assistant", content: reply.content })
        const output = reply.content.trim()
        emit({ type: "turn.completed", output })
        return output
      }

      emptyReplies = 0
      messages.push({ role: "assistant", content: reply.content, tool_calls: reply.toolCalls, ...(reply.reasoningContent ? { reasoning_content: reply.reasoningContent } : {}) })
      for (const call of reply.toolCalls) {
        signal?.throwIfAborted()
        const loop = nextToolLoopState(toolLoopState, call.function.name, call.function.arguments)
        toolLoopState = loop.state
        if (loop.repeated) throw new Error(`Stopped repeated tool loop after ${toolLoopState.count} identical calls: ${call.function.name}`)

        let args: unknown
        try {
          args = parseArguments(call)
        } catch (error) {
          messages.push({ role: "tool", tool_call_id: call.id, content: `ERROR: ${(error as Error).message}` })
          continue
        }
        emit({ type: "tool.started", step, callId: call.id, name: call.function.name, args })
        if (!toolEnabled(call.function.name, options)) {
          const output = `Tool is disabled by the active agent profile: ${call.function.name}`
          emit({ type: "tool.completed", step, callId: call.id, name: call.function.name, ok: false, output })
          messages.push({ role: "tool", tool_call_id: call.id, content: `ERROR: ${output}` })
          continue
        }
        const hookContext = await options.beforeTool?.(call.function.name, args)
        if (hookContext?.trim()) messages.push({ role: "user", content: `Tool hook context for ${call.function.name}:\n${hookContext.trim()}` })
        const toolContext: ToolContext = {
          ...options,
          ...(signal ? { signal } : {}),
          onToolOutput: (delta) => emit({ type: "tool.delta", step, callId: call.id, name: call.function.name, delta }),
          onPolicyDecision: (name, evaluation) => {
            emit({ type: "policy.decision", step, callId: call.id, name, ...evaluation })
            options.onPolicyDecision?.(name, evaluation)
          },
          approveTool: async (request) => {
            emit({ type: "approval.requested", step, callId: call.id, name: call.function.name, title: request.title, detail: request.detail, dangerous: request.dangerous, risk: request.risk, reason: request.reason, ...(request.matchedRule ? { matchedRule: request.matchedRule } : {}) })
            const choice = await options.approveTool?.(request) ?? false
            emit({ type: "approval.resolved", step, callId: call.id, name: call.function.name, approved: approved(choice), ...(typeof choice === "string" ? { choice } : {}) })
            return choice
          },
          approveShell: async (command) => {
            const request = approvalRequest(SHELL_TOOL, { command })
            emit({ type: "approval.requested", step, callId: call.id, name: call.function.name, title: request.title, detail: request.detail, dangerous: request.dangerous, risk: request.risk, reason: request.reason, ...(request.matchedRule ? { matchedRule: request.matchedRule } : {}) })
            const choice = await options.approveShell(command)
            emit({ type: "approval.resolved", step, callId: call.id, name: call.function.name, approved: approved(choice), ...(typeof choice === "string" ? { choice } : {}) })
            return choice
          },
        }
        const external = options.externalTools?.find((tool) => tool.definition.function.name === call.function.name)
        let result: ToolResult
        if (external) {
          const record = typeof args === "object" && args !== null ? args as Record<string, unknown> : {}
          const evaluation = (options.isPlanMode?.() ? planModeRestriction(call.function.name) : null)
            ?? options.policy?.evaluate(call.function.name, record)
            ?? { decision: "ask" as const, risk: "high" as const, reason: "External tool requires approval", matchedRule: "builtin.external-tool" }
          toolContext.onPolicyDecision?.(call.function.name, evaluation)
          if (evaluation.decision === "deny") result = { ok: false, output: `Permission denied: ${evaluation.reason}` }
          else if (evaluation.decision === "ask") {
            const choice = await toolContext.approveTool?.(approvalRequest(call.function.name, record, evaluation))
            if (approved(choice)) {
              if (typeof choice === "string") await options.policy?.remember(choice, call.function.name, record)
              result = await external.execute(args, toolContext)
            } else result = { ok: false, output: `${call.function.name} was not approved` }
          } else result = await external.execute(args, toolContext)
        } else result = await executeTool(call.function.name, args, toolContext)
        await options.afterTool?.(call.function.name, args, result)
        verificationState = updateVerificationState(verificationState, call.function.name, args, result.ok)
        options.onToolExecuted?.()
        emit({ type: "tool.completed", step, callId: call.id, name: call.function.name, ok: result.ok, output: result.output, ...(result.presentation ? { presentation: result.presentation } : {}) })
        messages.push({ role: "tool", tool_call_id: call.id, content: `${result.ok ? "OK" : "ERROR"}: ${result.output}` })
      }
    }
    throw new MaxSessionTurnsError(maxTurns)
  } catch (error) {
    const value = error instanceof Error ? error : new Error(String(error))
    emit({
      type: "turn.failed",
      message: value.message,
      aborted: value.name === "AbortError" || signal?.aborted === true,
      ...(value instanceof MaxSessionTurnsError ? { reason: "max_turns" as const } : {}),
    })
    throw value
  }
}
