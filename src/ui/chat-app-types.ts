import type { AgentConversation, AgentEvent } from "../agent.js"
import type { Args } from "../cli-args.js"
import type { DoCodeLanguage, ReasoningEffort, RuntimeModelConfig, ThinkingMode } from "../config.js"
import type { ProviderInstallInput } from "../provider-setup.js"
import type { Message } from "../protocol.js"
import type { LoadedSession, SavedSession } from "../sessions.js"
import type { ToolResult } from "../tools.js"
import type { ApprovalMode, PolicyEngine } from "../policy.js"
import type { PromptExtension } from "../extension-registry.js"
import type { ApprovalBridge, PlanPublisherBridge, QuestionBridge } from "./async-bridges.js"
import type { ImageAttachment } from "./attachment-model.js"
import type { TranscriptItem } from "./transcript-model.js"
import type { ViewportInputKey } from "./viewport-surface.js"
import type { RuntimeStore } from "./runtime-store.js"

export type ChatAppProps = {
  workspace: string
  model: string
  approvalMode: Args["approvalMode"]
  sessionId: string
  sessionTitle?: string
  restored: boolean
  agent?: string
  initialMessages: Message[]
  initialEvents?: unknown[]
  conversation: AgentConversation
  approvalBridge: ApprovalBridge
  questionBridge?: QuestionBridge
  planPublisher?: PlanPublisherBridge
  policy?: PolicyEngine
  setApprovalMode?: (mode: ApprovalMode) => void
  setPlanMode?: (active: boolean) => void
  initialPlanMode?: boolean
  attachEventSink: (sink: ((event: AgentEvent) => void) | null) => void
  runShellShortcut: (command: string) => Promise<ToolResult>
  listSessions: () => Promise<SavedSession[]>
  resumeSession: (id: string) => Promise<LoadedSession>
  renameCurrentSession: (title: string) => Promise<SavedSession>
  exportCurrentSession: (format: "md" | "json", output?: string) => Promise<string>
  save: () => Promise<void>
  reportError: (error: unknown, operation: string, category?: "exception" | "bad_case", context?: unknown) => Promise<{ id: string; file: string }>
  modelPresets?: string[]
  promptExtensions?: PromptExtension[]
  switchModel?: (preset: string) => Promise<RuntimeModelConfig>
  configureAuth?: (input: ProviderInstallInput) => Promise<RuntimeModelConfig>
  pasteImage?: () => Promise<ImageAttachment>
  pasteImagePaths?: (paths: string[]) => Promise<ImageAttachment[]>
  reasoningEffort?: ReasoningEffort
  switchEffort?: (effort: ReasoningEffort) => Promise<RuntimeModelConfig>
  thinkingMode?: ThinkingMode
  switchThinking?: (mode: ThinkingMode) => Promise<RuntimeModelConfig>
  language?: DoCodeLanguage
  setLanguage?: (language: DoCodeLanguage) => Promise<void>
  openTranscriptViewer?: (items: TranscriptItem[], language: DoCodeLanguage) => Promise<void>
  openHelp?: (language: DoCodeLanguage) => Promise<void>
  forwardViewportInput?: (input: string, key: ViewportInputKey) => void
  renderRevision?: number
  runtimeStore?: RuntimeStore
  followupSuggestions?: boolean
  generateFollowupSuggestion?: (signal: AbortSignal) => Promise<string | null>
}
