import { useRef, useSyncExternalStore } from "react"
import { createRuntimeStore, type RuntimeStore } from "../runtime-store.js"
import type { ChatAppProps } from "../chat-app-types.js"

function legacyRuntimeStore(props: ChatAppProps) {
  return createRuntimeStore({
    session: { id: props.sessionId, workspace: props.workspace, model: props.model, createdAt: "", updatedAt: "", directory: "", ...(props.sessionTitle ? { title: props.sessionTitle } : {}) },
    modelConfig: { source: "config", sourceLabel: "ui", preset: props.model, provider: "", modelId: props.model, baseUrl: "", apiKey: "", ...(props.reasoningEffort ? { reasoningEffort: props.reasoningEffort } : {}), ...(props.thinkingMode ? { thinkingMode: props.thinkingMode } : {}) },
    modelPresets: props.modelPresets ?? [], approvalMode: props.approvalMode, planMode: Boolean(props.initialPlanMode), language: props.language ?? "en",
  }, {
    ...(props.switchModel ? { switchModel: props.switchModel } : {}),
    ...(props.switchEffort ? { switchEffort: props.switchEffort } : {}),
    ...(props.switchThinking ? { switchThinking: props.switchThinking } : {}),
    ...(props.configureAuth ? { configureAuth: props.configureAuth } : {}),
    ...(props.setLanguage ? { setLanguage: props.setLanguage } : {}),
    ...(props.setApprovalMode || props.policy ? { setApprovalMode: (mode) => props.setApprovalMode ? props.setApprovalMode(mode) : props.policy?.setMode(mode) } : {}),
    ...(props.setPlanMode ? { setPlanMode: props.setPlanMode } : {}),
    resumeSession: props.resumeSession,
    renameSession: props.renameCurrentSession,
    persistSession: async () => { await props.save() },
  })
}

export function useRuntimeStore(props: ChatAppProps) {
  const storeRef = useRef<RuntimeStore | null>(null)
  if (!storeRef.current) storeRef.current = props.runtimeStore ?? legacyRuntimeStore(props)
  const store = storeRef.current
  return { snapshot: useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot), store }
}
