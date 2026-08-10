import type { DoCodeLanguage, ReasoningEffort, RuntimeModelConfig, ThinkingMode } from "../config.js"
import type { ApprovalMode } from "../policy.js"
import type { ProviderInstallInput } from "../provider-setup.js"
import type { LoadedSession, SavedSession } from "../sessions.js"

export type RuntimeSnapshot = {
  session: SavedSession
  modelConfig: RuntimeModelConfig
  modelPresets: string[]
  approvalMode: ApprovalMode
  planMode: boolean
  language: DoCodeLanguage
}

export type RuntimeCommands = {
  switchModel?: (preset: string, effort?: ReasoningEffort, thinking?: ThinkingMode) => Promise<RuntimeModelConfig>
  restoreModel?: (preset: string, effort?: ReasoningEffort, thinking?: ThinkingMode) => Promise<RuntimeModelConfig>
  switchEffort?: (effort: ReasoningEffort) => Promise<RuntimeModelConfig>
  switchThinking?: (thinking: ThinkingMode) => Promise<RuntimeModelConfig>
  configureAuth?: (input: ProviderInstallInput) => Promise<RuntimeModelConfig>
  setLanguage?: (language: DoCodeLanguage) => Promise<void>
  setApprovalMode?: (mode: ApprovalMode) => void
  setPlanMode?: (active: boolean) => void
  resumeSession?: (id: string) => Promise<LoadedSession>
  renameSession?: (title: string) => Promise<SavedSession>
  persistSession?: () => Promise<void>
}

export function createRuntimeStore(initial: RuntimeSnapshot, commands: RuntimeCommands = {}) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<RuntimeSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach((listener) => listener())
  }
  const applyModelConfig = (modelConfig: RuntimeModelConfig) => {
    publish({ modelConfig, session: { ...snapshot.session, model: modelConfig.preset } })
    return modelConfig
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
    canSwitchModel: Boolean(commands.switchModel),
    canSwitchEffort: Boolean(commands.switchEffort || commands.switchModel),
    canSwitchThinking: Boolean(commands.switchThinking || commands.switchModel),
    canConfigureAuth: Boolean(commands.configureAuth),
    async switchModel(preset: string) {
      if (!commands.switchModel) throw new Error("Model switching is unavailable")
      return applyModelConfig(await commands.switchModel(preset, snapshot.modelConfig.reasoningEffort, snapshot.modelConfig.thinkingMode))
    },
    async switchEffort(effort: ReasoningEffort) {
      if (commands.switchEffort) return applyModelConfig(await commands.switchEffort(effort))
      if (!commands.switchModel) throw new Error("Reasoning effort switching is unavailable")
      return applyModelConfig(await commands.switchModel(snapshot.modelConfig.preset, effort, snapshot.modelConfig.thinkingMode))
    },
    async switchThinking(thinking: ThinkingMode) {
      if (commands.switchThinking) return applyModelConfig(await commands.switchThinking(thinking))
      if (!commands.switchModel) throw new Error("Thinking mode switching is unavailable")
      return applyModelConfig(await commands.switchModel(snapshot.modelConfig.preset, snapshot.modelConfig.reasoningEffort, thinking))
    },
    async configureAuth(input: ProviderInstallInput) {
      if (!commands.configureAuth) throw new Error("Model configuration is unavailable")
      const config = applyModelConfig(await commands.configureAuth(input))
      const presets = input.modelIds?.map((modelId) => `${config.provider}/${modelId}`) ?? [config.preset]
      publish({ modelPresets: [...new Set([...snapshot.modelPresets, ...presets])] })
      return config
    },
    async setLanguage(language: DoCodeLanguage) { await commands.setLanguage?.(language); publish({ language }) },
    setApprovalMode(approvalMode: ApprovalMode) { commands.setApprovalMode?.(approvalMode); publish({ approvalMode }) },
    setPlanMode(planMode: boolean) { commands.setPlanMode?.(planMode); publish({ planMode }) },
    async resumeSession(id: string) {
      if (!commands.resumeSession) throw new Error("Session resume is unavailable")
      const loaded = await commands.resumeSession(id)
      const restoreModel = commands.restoreModel ?? commands.switchModel
      if (loaded.session.model && loaded.session.model !== snapshot.modelConfig.preset && restoreModel) {
        const restored = await restoreModel(loaded.session.model, snapshot.modelConfig.reasoningEffort, snapshot.modelConfig.thinkingMode).catch(() => null)
        if (restored) applyModelConfig(restored)
      }
      publish({ session: loaded.session })
      return loaded
    },
    async renameSession(title: string) {
      if (commands.renameSession) {
        const session = await commands.renameSession(title)
        publish({ session })
        return session
      }
      const previous = snapshot.session
      publish({ session: { ...previous, title: title.trim() } })
      try { await commands.persistSession?.(); return snapshot.session }
      catch (error) { publish({ session: previous }); throw error }
    },
    replaceSession(session: SavedSession) { publish({ session }) },
  }
}

export type RuntimeStore = ReturnType<typeof createRuntimeStore>
