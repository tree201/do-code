import type { AgentEvent, ChatModel, Message } from "./protocol.js"
import type { BackgroundProcessController, TodoItem, ToolContext } from "./tools.js"
import { InstructionMemory, type InstructionSource } from "./instructions.js"
import { CheckpointManager } from "./checkpoints.js"
import { BackgroundProcessManager } from "./background-processes.js"
import { buildCompactionPrompt, continuationState } from "./context-compaction.js"
import { estimateMessages, initialAgentMessages } from "./agent-context.js"
import { runAgentTurn } from "./agent-turn.js"

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
  attachmentDirectory?: string | (() => string)
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

export type AgentTurnOptions = { signal?: AbortSignal; displayInput?: string }

export class AgentConversation {
  private messages: Message[] | null = null
  private readonly memory: InstructionMemory
  private readonly checkpoints: CheckpointManager
  private readonly usage: ConversationStats
  private compacting = false
  private readonly processManager: BackgroundProcessController
  private todos: TodoItem[] = []

  constructor(private readonly options: AgentOptions) {
    this.memory = options.instructionMemory ?? new InstructionMemory(options.workspace)
    this.checkpoints = options.checkpointManager ?? new CheckpointManager(options.workspace)
    this.usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0, toolCalls: 0, compactions: 0, currentContextTokens: 0, contextWindow: options.contextWindow ?? 128_000 }
    this.processManager = options.processManager ?? new BackgroundProcessManager()
  }

  private async refreshSystemMessage() {
    const initial = await initialAgentMessages(this.options, this.memory)
    const first = initial[0]!
    if (first.role !== "system") throw new Error("Initial agent context must start with a system message")
    const content = first.content
    if (!this.messages) this.messages = initial
    else if (this.messages[0]?.role === "system") {
      if (this.messages[0].content !== content) this.messages[0] = { role: "system", content }
    }
    else this.messages.unshift({ role: "system", content })
  }

  async run(task: string, options: AgentTurnOptions = {}) {
    if (!this.messages) this.messages = await initialAgentMessages(this.options, this.memory)
    else await this.refreshSystemMessage()
    return await runAgentTurn(task, this.messages, {
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
        await this.refreshSystemMessage()
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
    this.messages = await initialAgentMessages(this.options, this.memory)
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

export async function runAgent(task: string, options: AgentOptions) {
  return await new AgentConversation(options).run(task, options.signal ? { signal: options.signal } : {})
}
