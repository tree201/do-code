import { normalizeLanguage } from "../config.js"
import { setWorkspaceTrusted } from "../policy.js"
import { availableLanguagesText, invalidLanguageText, languageDisplay, languageUsageText, t } from "./i18n.js"
import { approvalModeNotice } from "./chat-presentation.js"
import { modelPresetArgument, parseReasoningEffort, parseThinkingMode } from "./model-actions.js"
import { enqueueMessage } from "./message-queue.js"
import type { ApprovalMode } from "../policy.js"
import type { SlashCommandContext } from "./slash-command-context.js"
import { APPROVAL_MODE_COMMAND, AUTH_COMMAND, BUG_COMMAND, EFFORT_COMMAND, EXIT_COMMAND, EXTENSIONS_COMMAND, HELP_COMMAND, LANGUAGE_COMMAND, MODEL_COMMAND, PERMISSIONS_COMMAND, PLAN_COMMAND, QUIT_COMMAND, STATUS_COMMAND, THINKING_COMMAND, TRUST_COMMAND, UNTRUST_COMMAND, commandArgument, commandWithArgument } from "./shortcut-command-policy.js"
import { helpText } from "./slash-command-help.js"

export function executeGeneralSlashCommand(input: string, context: SlashCommandContext) {
  const { props, state, transcript, exit } = context
  if (input === EXIT_COMMAND || input === QUIT_COMMAND) { exit(); return true }
  if (input === HELP_COMMAND) {
    state.append({ kind: "info", text: helpText(state.activeLanguage) })
    return true
  }
  if (input === LANGUAGE_COMMAND) {
    state.append({ kind: "info", text: `${t(state.activeLanguage, "Current language")}: ${languageDisplay(state.activeLanguage, state.activeLanguage)}\n${t(state.activeLanguage, "Available languages")}: ${availableLanguagesText(state.activeLanguage)}\n${t(state.activeLanguage, "Usage")}: ${languageUsageText()}` })
    return true
  }
  if (commandWithArgument(input, LANGUAGE_COMMAND)) {
    const requested = normalizeLanguage(commandArgument(input, LANGUAGE_COMMAND))
    if (!requested) state.append({ kind: "error", text: invalidLanguageText(state.activeLanguage) })
    else void state.runtimeStore.setLanguage(requested).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Language setting failed"), error, "language.switch", { requested }))
    return true
  }
  if (input === MODEL_COMMAND) {
    if (!state.runtimeStore.canSwitchModel) state.append({ kind: "error", text: t(state.activeLanguage, "This client does not support model switching.") })
    else state.setActiveDialog({ kind: "model" })
    return true
  }
  if (input === AUTH_COMMAND) {
    if (!state.runtimeStore.canConfigureAuth) state.append({ kind: "error", text: t(state.activeLanguage, "This client does not support model configuration.") })
    else state.setActiveDialog({ kind: "auth" })
    return true
  }
  if (commandWithArgument(input, MODEL_COMMAND)) {
    const argument = commandArgument(input, MODEL_COMMAND)
    const persist = /(?:^|\s)--persist\s*$/.test(argument)
    const preset = modelPresetArgument(argument.replace(/^(?:set\s+)?|(?:^|\s)--persist\s*$/g, ""))
    if (!preset) { state.append({ kind: "error", text: t(state.activeLanguage, "Usage: /model set <model> [--persist]") }); return true }
    state.updateRunning(true); state.setActiveTool(t(state.activeLanguage, "Switching model"))
    if (!state.runtimeStore.canSwitchModel) { state.append({ kind: "error", text: t(state.activeLanguage, "This client does not support model switching.") }); state.updateRunning(false); state.setActiveTool(null) }
    else void state.runtimeStore.switchModel(preset).then(async () => {
      if (!persist) return
      await state.runtimeStore.persistDefaultModel(preset)
      state.append({ kind: "info", text: t(state.activeLanguage, "{preset} is now the default model for future sessions.", { preset }) })
    }).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Model switch failed"), error, "model.switch", { preset, persist })).finally(() => { state.updateRunning(false); state.setActiveTool(null) })
    return true
  }
  if (input === EFFORT_COMMAND) { state.append({ kind: "info", text: t(state.activeLanguage, "Reasoning effort: {effort}\nAvailable: low, medium, high, xhigh, max\nUsage: /effort <level> [--persist]", { effort: state.activeEffort }) }); return true }
  if (commandWithArgument(input, EFFORT_COMMAND)) {
    const argument = commandArgument(input, EFFORT_COMMAND)
    const persist = /(?:^|\s)--persist\s*$/.test(argument)
    const effort = parseReasoningEffort(argument.replace(/(?:^|\s)--persist\s*$/, ""))
    if (!effort) state.append({ kind: "error", text: t(state.activeLanguage, "Usage: /effort low|medium|high|xhigh|max [--persist]") })
    else if (!state.runtimeStore.canSwitchEffort) state.append({ kind: "error", text: t(state.activeLanguage, "This client does not support reasoning effort switching.") })
    else void state.runtimeStore.switchEffort(effort).then(async () => {
      if (!persist) return
      await state.runtimeStore.persistDefaultReasoningEffort(effort)
      state.append({ kind: "info", text: t(state.activeLanguage, "{effort} is now the default reasoning effort for future sessions.", { effort }) })
    }).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Effort switch failed"), error, "effort.switch", { effort, persist }))
    return true
  }
  if (input === THINKING_COMMAND) { state.append({ kind: "info", text: t(state.activeLanguage, "Thinking mode: {mode}\nAvailable: auto, on, off\nUsage: /thinking <mode> [--persist]", { mode: state.activeThinkingMode }) }); return true }
  if (commandWithArgument(input, THINKING_COMMAND)) {
    const argument = commandArgument(input, THINKING_COMMAND)
    const persist = /(?:^|\s)--persist\s*$/.test(argument)
    const mode = parseThinkingMode(argument.replace(/(?:^|\s)--persist\s*$/, ""))
    if (!mode) state.append({ kind: "error", text: t(state.activeLanguage, "Usage: /thinking auto|on|off [--persist]") })
    else if (!state.runtimeStore.canSwitchThinking) state.append({ kind: "error", text: t(state.activeLanguage, "This client does not support thinking mode switching.") })
    else void state.runtimeStore.switchThinking(mode).then(async () => {
      if (!persist) return
      await state.runtimeStore.persistDefaultThinkingMode(mode)
      state.append({ kind: "info", text: t(state.activeLanguage, "{mode} is now the default thinking mode for future sessions.", { mode }) })
    }).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Thinking mode switch failed"), error, "thinking.switch", { mode, persist }))
    return true
  }
  if (input === EXTENSIONS_COMMAND) { state.append({ kind: "info", text: props.promptExtensions?.length ? props.promptExtensions.map((item) => `/${item.name}  [${item.kind} · ${item.source}] ${item.description}`).join("\n") : t(state.activeLanguage, "No custom commands or skills are loaded.") }); return true }
  if (commandWithArgument(input, BUG_COMMAND)) {
    const description = commandArgument(input, BUG_COMMAND) || t(state.activeLanguage, "User captured the current bad case")
    state.updateRunning(true); state.setActiveTool(t(state.activeLanguage, "Collecting diagnostics"))
    void props.reportError(new Error(description), "interactive.bad_case", "bad_case", { description }).then((report) => state.append({ kind: "info", text: t(state.activeLanguage, "Bad case saved.\nError ID: {id}\nLog: {file}\nSend me this ID when you want to investigate it.", { id: report.id, file: report.file }) })).catch((error) => state.append({ kind: "error", text: t(state.activeLanguage, "Failed to save bad case: {message}", { message: error instanceof Error ? error.message : String(error) }) })).finally(() => { state.updateRunning(false); state.setActiveTool(null) })
    return true
  }
  if (input === STATUS_COMMAND) {
    void props.conversation.memorySources().then((sources) => { state.setMemoryCount(sources.length); state.append({ kind: "info", text: t(state.activeLanguage, "Workspace: {workspace}\nModel: {model}\nThinking mode: {thinkingMode}\nReasoning effort: {effort}\nSession: {session}\nPlan mode: {planMode}\nApproval mode: {approvalMode}\nTrusted workspace: {trusted}\nContext messages: {messages}\nProject instructions: {sources} source(s)", { workspace: props.workspace, model: state.activeModel, thinkingMode: state.activeThinkingMode, effort: state.activeEffort, session: `${state.activeSessionId}${state.activeSessionTitle ? ` · ${state.activeSessionTitle}` : ""}`, planMode: state.activePlanMode ? t(state.activeLanguage, "on") : t(state.activeLanguage, "off"), approvalMode: state.activeApprovalMode, trusted: state.trusted ? t(state.activeLanguage, "yes") : t(state.activeLanguage, "no"), messages: props.conversation.history().length, sources: sources.length }) }) }).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Failed to read status"), error, "status.read"))
    return true
  }
  if (input === PERMISSIONS_COMMAND) {
    const modes: ApprovalMode[] = ["ask", "auto", "full-access"]
    const index = Math.max(0, modes.indexOf(state.activeApprovalMode)); state.setActiveDialog({ kind: "permission-menu", selectedIndex: index })
    return true
  }
  if (commandWithArgument(input, PLAN_COMMAND)) {
    const goal = commandArgument(input, PLAN_COMMAND)
    if (goal === "exit") state.applyPlanMode(false)
    else { state.applyPlanMode(true); if (goal) state.setQueuedInputs((current) => enqueueMessage(current, goal)) }
    return true
  }
  if (commandWithArgument(input, APPROVAL_MODE_COMMAND)) {
    const requested = commandArgument(input, APPROVAL_MODE_COMMAND)
    if (!requested) state.append({ kind: "info", text: (["ask", "auto", "full-access"] as ApprovalMode[]).map((mode) => approvalModeNotice(mode, state.activeLanguage)).join("\n\n") })
    else if (!["ask", "auto", "full-access"].includes(requested)) state.append({ kind: "error", text: t(state.activeLanguage, "Usage: /approval-mode [ask|auto|full-access]; use /plan for planning.") })
    else state.applyApprovalMode(requested as ApprovalMode)
    return true
  }
  if (input === TRUST_COMMAND || input === UNTRUST_COMMAND) {
    const next = input === TRUST_COMMAND
    void setWorkspaceTrusted(props.workspace, next).then(() => state.setTrusted(next)).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Failed to update workspace trust"), error, "workspace.trust"))
    return true
  }
  return false
}
