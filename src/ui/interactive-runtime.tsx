import path from "node:path"
import React from "react"
import { AgentConversation, type AgentEvent } from "../agent.js"
import type { Args } from "../cli-args.js"
import { listModelPresets, outputLanguageInstruction, rememberRecentModel, resolveAgentProfile, resolveRuntimeModelConfig, saveDefaultModel, saveDefaultReasoningEffort, saveDefaultThinkingMode, saveLanguagePreference, type DoCodeLanguage, type ResolvedConfig, type RuntimeModelConfig, type SandboxNetworkMode } from "../config.js"
import { reportError } from "../error-reports.js"
import { loadPromptExtensions } from "../extension-registry.js"
import { HookRunner } from "../hooks.js"
import { importImageAttachment, readClipboardImage } from "../image-attachments.js"
import { McpManager } from "../mcp.js"
import { createChatModel, type SwitchableModel } from "../model.js"
import { approvalRequest, createPolicyEngine, type ApprovalMode } from "../policy.js"
import { installProvider, type ProviderInstallInput } from "../provider-setup.js"
import { createSandboxShellRunner, createSandboxShellSpawnSpec } from "../sandbox.js"
import { listSessions } from "../sessions.js"
import { executeTool } from "../tools.js"
import { CheckpointManager } from "../checkpoints.js"
import { ApprovalBridge, PlanReviewBridge, QuestionBridge } from "./async-bridges.js"
import { ChatApp } from "./chat-app-component.js"
import { createInteractiveRenderer } from "./interactive-renderer.js"
import { createInteractiveSessionStore } from "./interactive-session-store.js"
import { createRuntimeStore, type RuntimeStore } from "./runtime-store.js"

const SHELL_TOOL = "shell"
const DELEGATE_TIMEOUT_MS = 90_000
const DELEGATE_MAX_TURNS = 6

export async function runInteractiveChat(args: Args, model: SwitchableModel, modelConfig: RuntimeModelConfig, config: ResolvedConfig) {
  const profile = resolveAgentProfile(config, args.agent)
  const initialLanguage: DoCodeLanguage = config.language ?? "en"
  const instructions = (language: DoCodeLanguage) => [profile?.instructions, outputLanguageInstruction(language)].filter(Boolean).join("\n\n")
  const initialApprovalMode: ApprovalMode = args.approvalMode
  const policy = await createPolicyEngine(args.workspace, initialApprovalMode)
  const extensions = await loadPromptExtensions(args.workspace)
  const activeSandbox = () => policy.mode === "full-access" ? { type: "local" as const, network: "full" as const } : { ...config.sandbox, network: "full" as const }
  const spawnSpec = (command: string, network: SandboxNetworkMode = "none") => createSandboxShellSpawnSpec(args.workspace, activeSandbox(), command, network)
  const hookRunner = new HookRunner(args.workspace, config.hooks, 10_000, policy, spawnSpec)
  const mcpManager = new McpManager(args.workspace, config.mcpServers, policy)
  const externalTools = await mcpManager.load()
  const shellRunner = async (...runnerArgs: Parameters<ReturnType<typeof createSandboxShellRunner>>) => await createSandboxShellRunner(args.workspace, activeSandbox())(...runnerArgs)
  let conversation: AgentConversation
  let runtimeStore: RuntimeStore
  const store = await createInteractiveSessionStore({ workspace: args.workspace, ...(args.sessionId ? { requestedSessionId: args.sessionId } : {}), continueSession: args.continueSession, modelConfig, conversation: () => conversation, runtime: () => runtimeStore?.getSnapshot() })
  const approvalBridge = new ApprovalBridge()
  const questionBridge = new QuestionBridge()
  const planReviewBridge = new PlanReviewBridge()
  let eventSink: ((event: AgentEvent) => void) | null = null
  await hookRunner.fire("sessionStart", { mode: "interactive", model: modelConfig.preset })

  const applyRuntimeModel = async (preset: string, effort = runtimeStore.getSnapshot().modelConfig.reasoningEffort, thinking = runtimeStore.getSnapshot().modelConfig.thinkingMode) => {
    const next = await resolveRuntimeModelConfig(args.workspace, preset, undefined, effort, thinking)
    model.switchTo(next.preset, createChatModel(next))
    return next
  }
  const switchRuntimeModel = async (preset: string, effort = runtimeStore.getSnapshot().modelConfig.reasoningEffort, thinking = runtimeStore.getSnapshot().modelConfig.thinkingMode) => {
    const next = await applyRuntimeModel(preset, effort, thinking)
    await rememberRecentModel({ providerID: next.provider, modelID: next.modelId })
    return next
  }
  runtimeStore = createRuntimeStore({
    session: store.session(), modelConfig, modelPresets: listModelPresets(config), approvalMode: initialApprovalMode, planMode: false, language: initialLanguage,
  }, {
    switchModel: switchRuntimeModel,
    persistDefaultModel: async (preset) => { await saveDefaultModel(preset) },
    persistDefaultReasoningEffort: async (effort) => { await saveDefaultReasoningEffort(effort) },
    persistDefaultThinkingMode: async (thinking) => { await saveDefaultThinkingMode(thinking) },
    restoreModel: applyRuntimeModel,
    configureAuth: async (input) => { const installed = await installProvider(input); return await switchRuntimeModel(`${installed.providerId}/${installed.models[0]}`) },
    setLanguage: async (language) => { await saveLanguagePreference(language); await conversation.setProfileInstructions(instructions(language)) },
    resumeSession: store.resume,
    persistSession: async () => { await store.save(true) },
  })
  policy.setModeSource(() => runtimeStore.getSnapshot().approvalMode)

  conversation = new AgentConversation({
    workspace: args.workspace, maxSteps: args.maxSteps, requireVerification: true, model, externalTools, profileInstructions: instructions(initialLanguage),
    ...(profile?.tools?.allow ? { toolAllowList: profile.tools.allow } : {}), ...(profile?.tools?.deny ? { toolDenyList: profile.tools.deny } : {}),
    runShell: shellRunner, shellSpawnSpec: spawnSpec,
    beforeModelRequest: async (messages) => { const context = await hookRunner.context("beforeModel", { messages: messages.slice(-8) }); if (context) messages.push({ role: "user", content: `Hook context:\n${context}` }) },
    beforeTool: async (name, toolArgs) => await hookRunner.context("beforeTool", { name, args: toolArgs }),
    afterTool: async (name, toolArgs, result) => { await hookRunner.fire("afterTool", { name, args: toolArgs, result }) },
    ...(config.subagents?.enabled === false ? {} : { delegateTask: async (subtask: string, signal?: AbortSignal) => {
      const timeout = AbortSignal.timeout(DELEGATE_TIMEOUT_MS)
      const childSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
      try {
        return await new AgentConversation({ workspace: args.workspace, maxSteps: Math.min(args.maxSteps, DELEGATE_MAX_TURNS), model, approvalMode: "ask", isPlanMode: () => true, approveShell: async () => false, approveTool: async () => false }).run(subtask, { signal: childSignal })
      } catch (error) {
        if (signal?.aborted) throw error
        if (timeout.aborted) return "Delegated research timed out after 90 seconds. Continue the task directly with the findings already available to the main agent."
        throw error
      }
    } }),
    checkpointManager: new CheckpointManager(args.workspace, store.sessionId), attachmentDirectory: store.attachmentDirectory(), policy, approvalMode: initialApprovalMode,
    isPlanMode: () => runtimeStore.getSnapshot().planMode,
    approveTool: async (request) => await approvalBridge.request(request),
    approveShell: async (command) => await approvalBridge.request(approvalRequest(SHELL_TOOL, { command }, policy.evaluate(SHELL_TOOL, { command }))),
    askUser: async (question, options) => await questionBridge.request(question, options),
    enterPlanMode: async () => { runtimeStore.setPlanMode(true); return runtimeStore.getSnapshot().approvalMode },
    reviewPlan: async (proposal) => { const decision = await planReviewBridge.request(proposal); if (decision === "execute" || decision === "cancel") runtimeStore.setPlanMode(false); return decision },
    onEvent: (event) => { store.recordEvent(event); eventSink?.(event) },
  })
  if (store.restored) conversation.restore(store.restored.messages)

  const pasteImage = async () => { const imported = await readClipboardImage(store.attachmentDirectory()); return { reference: path.posix.join("attachments", imported.name), name: imported.name, size: imported.size } }
  const pasteImagePaths = async (paths: string[]) => {
    const imported = await Promise.all(paths.map(async (source) => { const file = path.isAbsolute(source) ? source : path.resolve(args.workspace, source); try { const image = await importImageAttachment(file, store.attachmentDirectory()); return { reference: path.posix.join("attachments", image.name), name: path.basename(source), size: image.size } } catch { return null } }))
    return imported.filter((image): image is NonNullable<typeof image> => image !== null)
  }

  let renderer: ReturnType<typeof createInteractiveRenderer>
  const createApp = () => <ChatApp
    workspace={args.workspace} model={store.modelConfig().preset} reasoningEffort={store.modelConfig().reasoningEffort ?? "medium"} thinkingMode={store.modelConfig().thinkingMode ?? "auto"}
    approvalMode={initialApprovalMode} initialPlanMode={false} sessionId={store.sessionId} {...(store.restored?.session.title ? { sessionTitle: store.restored.session.title } : {})}
    restored={Boolean(store.restored)} {...(profile?.name ? { agent: profile.name } : {})} initialMessages={store.restored?.messages ?? []} initialEvents={store.restored?.events ?? []}
    conversation={conversation} approvalBridge={approvalBridge} questionBridge={questionBridge} planReviewBridge={planReviewBridge} policy={policy}
    attachEventSink={(sink) => { eventSink = sink }} runtimeStore={runtimeStore}
    runShellShortcut={async (command) => await executeTool(SHELL_TOOL, { command }, { workspace: args.workspace, policy, approvalMode: runtimeStore.getSnapshot().approvalMode, isPlanMode: () => runtimeStore.getSnapshot().planMode, approveTool: async (request) => await approvalBridge.request(request), approveShell: async (requested) => await approvalBridge.request(approvalRequest(SHELL_TOOL, { command: requested }, policy.evaluate(SHELL_TOOL, { command: requested }))), runShell: shellRunner, shellSpawnSpec: spawnSpec })}
    listSessions={async () => await listSessions(args.workspace)} resumeSession={store.resume} renameCurrentSession={store.rename} exportCurrentSession={store.exportCurrent} save={store.save}
    reportError={async (error, operation, category, context) => await reportError({ error, operation, ...(category ? { category } : {}), workspace: args.workspace, sessionId: store.session().id, model: store.modelConfig().preset, context: { input: context, approvalMode: args.approvalMode, maxSteps: args.maxSteps, stats: conversation.stats(), messages: conversation.history().slice(-30), events: store.events().slice(-150) } })}
    modelPresets={listModelPresets(config)} promptExtensions={extensions} language={initialLanguage} openTranscriptViewer={renderer.openTranscriptViewer} forwardTranscriptViewerInput={renderer.forwardViewerInput} renderRevision={renderer.revision()}
    pasteImage={pasteImage} pasteImagePaths={pasteImagePaths}
  />
  renderer = createInteractiveRenderer(createApp)
  const instance = renderer.start()
  try {
    await instance.waitUntilExit(); await store.save(); await hookRunner.fire("sessionEnd", { sessionId: store.session().id }); mcpManager.close()
  } finally {
    renderer.stop()
  }
  process.stdout.write(`\n${runtimeStore.getSnapshot().language === "zh" ? "恢复此会话：" : "Resume this session:"}\n  do-code resume ${runtimeStore.getSnapshot().session.id}\n`)
}
