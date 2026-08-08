import { AGENT_EVENT_PROTOCOL_VERSION, type AgentEvent, type AgentEventPayload, type ChatModel, type Message, type ToolCall } from "./protocol.js"
import { executeTool, toolDefinitions, type TodoItem, type ToolContext } from "./tools.js"
import { expandPromptContent } from "./file-context.js"
import { InstructionMemory, type InstructionSource } from "./instructions.js"
import { CheckpointManager, type Checkpoint } from "./checkpoints.js"
import { approvalRequest, planModeRestriction } from "./policy.js"
import { approved, type ApprovalChoice } from "./policy.js"
import { BackgroundProcessManager } from "./background-processes.js"
import { buildCompactionPrompt, continuationState } from "./context-compaction.js"
import {
  appendRecoveryContinuation,
  clampOutputTokens,
  DEFAULT_MAX_OUTPUT_TOKENS,
  ESCALATED_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_RECOVERY_ATTEMPTS,
  outputRecoveryMessage,
} from "./output-recovery.js"
import { isMutationTool, verificationCommand } from "./completion-verification.js"
import { DEFAULT_MAX_TURNS, IDENTICAL_TOOL_LOOP_THRESHOLD, MaxSessionTurnsError } from "./turn-limits.js"

export type { AgentEvent } from "./protocol.js"

export type AgentOptions = ToolContext & {
  model: ChatModel
  maxSteps?: number
  signal?: AbortSignal
  onEvent?: (event: AgentEvent) => void
  instructionMemory?: InstructionMemory
  checkpointManager?: CheckpointManager
  contextWindow?: number
  onModelUsage?: (usage: NonNullable<import("./protocol.js").ModelReply["usage"]>) => void
  beforeModelRequest?: (messages: Message[]) => Promise<void>
  onToolExecuted?: () => void
  externalTools?: Array<{
    definition: import("./protocol.js").ToolDefinition
    execute: (args: unknown, context: ToolContext) => Promise<import("./tools.js").ToolResult>
  }>
  beforeTool?: (name: string, args: unknown) => Promise<string | void>
  afterTool?: (name: string, args: unknown, result: import("./tools.js").ToolResult) => Promise<void>
  profileInstructions?: string
  toolAllowList?: string[]
  toolDenyList?: string[]
  requireVerification?: boolean
}

export type ConversationStats = {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  requests: number
  toolCalls: number
  compactions: number
  currentContextTokens: number
  contextWindow: number
}

export type AgentTurnOptions = { signal?: AbortSignal }

function systemPrompt(workspace: string, projectInstructions: string, profileInstructions = "", planningEnabled = false) {
  return [
    "You are a coding agent working directly in a software repository.",
    `Workspace: ${workspace}`,
    "Inspect the repository before editing. Make the smallest coherent change that completes the user's request.",
    "Use tools to read and modify files. Run relevant tests or checks before finishing whenever possible.",
    "Do not claim a command passed unless you observed its tool result. In the final answer, summarize changes and verification.",
    "Never return an empty response. After thinking, either call a tool or provide a final user-facing answer.",
    planningEnabled ? "For a genuinely ambiguous, architectural, cross-cutting, or high-risk task, proactively call enter_plan_mode before making changes. Do not enter plan mode for small, obvious tasks." : "",
    planningEnabled ? "While planning, research with read-only tools, discuss material trade-offs with the user through ask_user, and only then submit one concrete implementation plan through exit_plan_mode." : "",
    planningEnabled ? "exit_plan_mode performs the formal approval interaction. Do not separately ask whether the plan is approved. If approved, continue implementing immediately with the unchanged approval mode; if revision or cancellation is requested, stop without editing." : "",
    profileInstructions ? "Follow the active agent profile instructions below." : "",
    profileInstructions,
    projectInstructions ? "Follow the loaded hierarchical instructions below. More specific project or subdirectory instructions override broader project instructions; project instructions override global preferences when they conflict." : "",
    projectInstructions,
  ]
    .filter(Boolean)
    .join("\n\n")
}

function parseArguments(call: ToolCall) {
  try {
    return JSON.parse(call.function.arguments) as unknown
  } catch {
    throw new Error(`Invalid JSON arguments for ${call.function.name}`)
  }
}

async function initialMessages(options: AgentOptions, memory: InstructionMemory): Promise<Message[]> {
  return [{ role: "system", content: systemPrompt(options.workspace, await memory.prompt(), options.profileInstructions, Boolean(options.enterPlanMode && options.reviewPlan)) }]
}

function toolEnabled(name: string, options: AgentOptions) {
  if ((name === "enter_plan_mode" || name === "exit_plan_mode") && (!options.enterPlanMode || !options.reviewPlan)) return false
  if (options.toolDenyList?.some((entry) => entry === "*" || entry === name)) return false
  return !options.toolAllowList?.length || options.toolAllowList.some((entry) => entry === "*" || entry === name)
}

async function runTurn(task: string, messages: Message[], options: AgentOptions, turnOptions: AgentTurnOptions = {}) {
  const turnId = `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const emit = (event: AgentEventPayload) => {
    options.onEvent?.({ protocolVersion: AGENT_EVENT_PROTOCOL_VERSION, turnId, ...event } as AgentEvent)
  }
  const signal = turnOptions.signal ?? options.signal
  messages.push({ role: "user", content: await expandPromptContent(task, options.workspace) })
  emit({ type: "turn.started", input: task })
  const maxTurns = options.maxSteps ?? DEFAULT_MAX_TURNS
  let lastToolSignature: string | null = null
  let identicalToolCallCount = 0
  let emptyReplies = 0
  let unverifiedMutation = false
  let verificationNudges = 0

  try {
    for (let step = 1; step <= maxTurns; step++) {
      signal?.throwIfAborted()
      await options.beforeModelRequest?.(messages)
      emit({ type: "step.started", step })
      const availableTools = [...toolDefinitions, ...(options.externalTools ?? []).map((tool) => tool.definition)].filter((tool) => toolEnabled(tool.function.name, options))
      const recoveryStart = messages.length
      let recoveryAttempts = 0
      let accumulatedContent = ""
      let accumulatedReasoning = ""
      let reasoningCharacters = 0
      let pendingReasoningCharacters = 0
      let lastReasoningEventAt = 0
      const pendingContentDeltas: string[] = []
      let maxOutputTokens = clampOutputTokens(
        DEFAULT_MAX_OUTPUT_TOKENS,
        options.contextWindow ?? 128_000,
        estimateMessages(messages),
      )
      let reply: import("./protocol.js").ModelReply

      while (true) {
        let bufferedDelta = ""
        const isContinuation = recoveryAttempts > 0
        reply = await options.model.complete(
          { messages, tools: availableTools },
          {
            ...(signal ? { signal } : {}),
            maxOutputTokens,
            onContentDelta: (delta) => {
              if (!delta) return
              bufferedDelta += delta
              if (!isContinuation) pendingContentDeltas.push(delta)
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
        messages.push({
          role: "assistant",
          content: reply.content,
          ...(reply.reasoningContent ? { reasoning_content: reply.reasoningContent } : {}),
        })
        messages.push({ role: "user", content: outputRecoveryMessage(accumulatedContent) })
        recoveryAttempts++
        maxOutputTokens = clampOutputTokens(
          ESCALATED_MAX_OUTPUT_TOKENS,
          options.contextWindow ?? 128_000,
          estimateMessages(messages),
        )
      }

      if (recoveryAttempts > 0) {
        const content = appendRecoveryContinuation(accumulatedContent, reply.content ?? "")
        const reasoningContent = appendRecoveryContinuation(accumulatedReasoning, reply.reasoningContent ?? "")
        messages.splice(recoveryStart)
        reply = {
          ...reply,
          content: content || null,
          ...(reasoningContent ? { reasoningContent } : {}),
        }
      }
      if (reply.toolCalls.length === 0) {
        if (!reply.content?.trim()) {
          emptyReplies++
          const reason = reply.finishReason || "unknown"
          const thoughtOnly = Boolean(reply.reasoningContent?.trim())
          if (emptyReplies >= 3) {
            if (reason === "length" || reason === "max_tokens") {
              throw new Error(`Model exhausted its output token limit without a final answer after 3 attempts (finish_reason: ${reason})`)
            }
            if (thoughtOnly) {
              throw new Error(`Model returned reasoning but no tool call or final answer after 3 attempts (finish_reason: ${reason})`)
            }
            throw new Error(`Model returned neither tool calls nor a final answer after 3 attempts (finish_reason: ${reason})`)
          }
          messages.push({
            role: "user",
            content: thoughtOnly
              ? "Your previous response contained reasoning but no actionable output. Continue now by calling the required tool, or provide the final user-facing answer. Do not return more reasoning without an action."
              : `Your previous response was empty (finish_reason: ${reason}). Continue the task by calling a tool or providing the final user-facing answer.`,
          })
          continue
        }
        if (options.requireVerification && unverifiedMutation && verificationNudges < 1) {
          messages.push({ role: "assistant", content: reply.content })
          messages.push({ role: "user", content: "Completion gate: workspace files changed after the last successful verification. Before finishing, run the most relevant test, build, lint, typecheck, or equivalent check. If no automated check is available, explain that explicitly in the final answer." })
          verificationNudges++
          continue
        }
        const finalDeltas = recoveryAttempts > 0
          ? [reply.content]
          : pendingContentDeltas.length
            ? pendingContentDeltas
            : [reply.content]
        for (const delta of finalDeltas) {
          if (delta) emit({ type: "message.delta", step, delta })
        }
        messages.push({ role: "assistant", content: reply.content })
        const output = reply.content.trim()
        emit({ type: "turn.completed", output })
        return output
      }

      emptyReplies = 0
      messages.push({
        role: "assistant",
        content: reply.content,
        tool_calls: reply.toolCalls,
        ...(reply.reasoningContent ? { reasoning_content: reply.reasoningContent } : {}),
      })

      for (const call of reply.toolCalls) {
        signal?.throwIfAborted()
        const signature = `${call.function.name}:${call.function.arguments}`
        if (signature === lastToolSignature) identicalToolCallCount++
        else {
          lastToolSignature = signature
          identicalToolCallCount = 1
        }
        if (identicalToolCallCount >= IDENTICAL_TOOL_LOOP_THRESHOLD) {
          throw new Error(`Stopped repeated tool loop after ${IDENTICAL_TOOL_LOOP_THRESHOLD} identical calls: ${call.function.name}`)
        }

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
            const request = approvalRequest("shell", { command })
            emit({ type: "approval.requested", step, callId: call.id, name: call.function.name, title: request.title, detail: request.detail, dangerous: request.dangerous, risk: request.risk, reason: request.reason, ...(request.matchedRule ? { matchedRule: request.matchedRule } : {}) })
            const choice = await options.approveShell(command)
            emit({ type: "approval.resolved", step, callId: call.id, name: call.function.name, approved: approved(choice), ...(typeof choice === "string" ? { choice } : {}) })
            return choice
          },
        }
        const external = options.externalTools?.find((tool) => tool.definition.function.name === call.function.name)
        let result: import("./tools.js").ToolResult
        if (external) {
          const record = typeof args === "object" && args !== null ? args as Record<string, unknown> : {}
          const evaluation = (options.isPlanMode?.() ? planModeRestriction(call.function.name) : null)
            ?? options.policy?.evaluate(call.function.name, record)
            ?? { decision: "ask" as const, risk: "high" as const, reason: "External tool requires approval", matchedRule: "builtin.external-tool" }
          toolContext.onPolicyDecision?.(call.function.name, evaluation)
          if (evaluation.decision === "deny") result = { ok: false, output: `Permission denied: ${evaluation.reason}` }
          else if (evaluation.decision === "ask") {
            const request = approvalRequest(call.function.name, record, evaluation)
            const choice = await toolContext.approveTool?.(request)
            if (approved(choice)) {
              if (typeof choice === "string") await options.policy?.remember(choice, call.function.name, record)
              result = await external.execute(args, toolContext)
            } else result = { ok: false, output: `${call.function.name} was not approved` }
          } else result = await external.execute(args, toolContext)
        } else {
          result = await executeTool(call.function.name, args, toolContext)
        }
        await options.afterTool?.(call.function.name, args, result)
        if (result.ok && isMutationTool(call.function.name)) unverifiedMutation = true
        const checkedCommand = call.function.name === "shell" ? verificationCommand(args) : null
        if (checkedCommand && result.ok) unverifiedMutation = false
        options.onToolExecuted?.()
        emit({ type: "tool.completed", step, callId: call.id, name: call.function.name, ok: result.ok, output: result.output, ...(result.presentation ? { presentation: result.presentation } : {}) })
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `${result.ok ? "OK" : "ERROR"}: ${result.output}`,
        })
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

export class AgentConversation {
  private messages: Message[] | null = null
  private readonly memory: InstructionMemory
  private readonly checkpoints: CheckpointManager
  private readonly usage: ConversationStats
  private compacting = false
  private readonly processManager: BackgroundProcessManager
  private todos: TodoItem[] = []

  constructor(private readonly options: AgentOptions) {
    this.memory = options.instructionMemory ?? new InstructionMemory(options.workspace)
    this.checkpoints = options.checkpointManager ?? new CheckpointManager(options.workspace)
    this.usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0, toolCalls: 0, compactions: 0, currentContextTokens: 0, contextWindow: options.contextWindow ?? 128_000 }
    this.processManager = options.processManager ?? new BackgroundProcessManager()
  }

  private async refreshSystemMessage() {
    const content = systemPrompt(this.options.workspace, await this.memory.prompt(), this.options.profileInstructions, Boolean(this.options.enterPlanMode && this.options.reviewPlan))
    if (!this.messages) this.messages = [{ role: "system", content }]
    else if (this.messages[0]?.role === "system") this.messages[0] = { role: "system", content }
    else this.messages.unshift({ role: "system", content })
  }

  async run(task: string, options: AgentTurnOptions = {}) {
    if (!this.messages) this.messages = await initialMessages(this.options, this.memory)
    else await this.refreshSystemMessage()
    return await runTurn(task, this.messages, {
      ...this.options,
      onPathAccess: async (requestedPath) => {
        const added = await this.memory.discover(requestedPath)
        if (added.length > 0) await this.refreshSystemMessage()
        await this.options.onPathAccess?.(requestedPath)
      },
      beforeFileWrite: async (tool, requestedPath) => {
        await this.checkpoints.create(tool, requestedPath, this.messages?.length ?? 0)
        await this.options.beforeFileWrite?.(tool, requestedPath)
      },
      processManager: this.processManager,
      getTodos: () => [...this.todos],
      setTodos: (items) => { this.todos = [...items] },
      onModelUsage: (usage) => {
        this.usage.inputTokens += usage.inputTokens
        this.usage.outputTokens += usage.outputTokens
        this.usage.cachedTokens += usage.cachedTokens
        this.usage.requests += 1
        this.usage.currentContextTokens = usage.inputTokens
        this.options.onModelUsage?.(usage)
      },
      beforeModelRequest: async (messages) => {
        this.usage.currentContextTokens = estimateMessages(messages)
        if (!this.compacting && this.usage.currentContextTokens >= this.usage.contextWindow * 0.8 && messages.length > 8) await this.compact()
        await this.options.beforeModelRequest?.(messages)
      },
      onToolExecuted: () => {
        this.usage.toolCalls += 1
        this.options.onToolExecuted?.()
      },
    }, options)
  }

  async clear() {
    this.messages = await initialMessages(this.options, this.memory)
  }

  async setProfileInstructions(instructions?: string) {
    if (instructions) this.options.profileInstructions = instructions
    else delete this.options.profileInstructions
    if (this.messages) await this.refreshSystemMessage()
  }

  restore(messages: Message[]) {
    this.messages = [...messages]
  }

  history() {
    return [...(this.messages ?? [])]
  }

  async memorySources(): Promise<InstructionSource[]> {
    return await this.memory.list()
  }

  async reloadMemory(): Promise<InstructionSource[]> {
    const sources = await this.memory.reload()
    await this.refreshSystemMessage()
    return sources
  }

  async checkpointsList(): Promise<Checkpoint[]> {
    return await this.checkpoints.list()
  }

  async restoreCheckpoint(id?: string) {
    return await this.checkpoints.restore(id)
  }

  async rewind(mode: "both" | "chat" | "files" = "both") {
    const latest = (await this.checkpoints.list())[0]
    if (!latest) throw new Error("No checkpoints found")
    if (mode !== "chat") await this.checkpoints.restore(latest.id)
    if (mode !== "files" && this.messages) {
      const before = this.messages.slice(0, latest.messageCount)
      const lastUser = before.map((message) => message.role).lastIndexOf("user")
      this.messages = lastUser >= 0 ? before.slice(0, lastUser) : before
      await this.refreshSystemMessage()
    }
    return latest
  }

  stats(): ConversationStats {
    return { ...this.usage, currentContextTokens: this.messages ? estimateMessages(this.messages) : 0 }
  }

  async compact() {
    if (!this.messages || this.messages.length <= 2) return false
    this.compacting = true
    try {
      const system = this.messages[0]?.role === "system" ? this.messages[0] : null
      const sourceMessages = this.messages.slice(system ? 1 : 0)
      const reply = await this.options.model.complete({
        messages: [
          ...(system ? [system] : []),
          { role: "user", content: buildCompactionPrompt(sourceMessages) },
        ],
        tools: [],
      })
      if (!reply.content?.trim()) throw new Error("The model did not return a context summary")
      if (reply.usage) {
        this.usage.inputTokens += reply.usage.inputTokens
        this.usage.outputTokens += reply.usage.outputTokens
        this.usage.cachedTokens += reply.usage.cachedTokens
        this.usage.requests += 1
      }
      const compacted: Message[] = [
        ...(system ? [system] : []),
        { role: "user", content: continuationState(sourceMessages, reply.content) },
      ]
      this.messages.splice(0, this.messages.length, ...compacted)
      this.usage.compactions += 1
      this.usage.currentContextTokens = estimateMessages(this.messages)
      return true
    } finally {
      this.compacting = false
    }
  }
}

function estimateMessages(messages: Message[]) {
  const characters = messages.reduce((total, message) => total + JSON.stringify(message).length, 0)
  return Math.ceil(characters / 3.5)
}

export async function runAgent(task: string, options: AgentOptions) {
  return await new AgentConversation(options).run(task, options.signal ? { signal: options.signal } : {})
}
