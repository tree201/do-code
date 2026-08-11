import { normalizeLanguage } from "../config.js"
import { setWorkspaceTrusted } from "../policy.js"
import { availableLanguagesText, invalidLanguageText, languageDisplay, languageUsageText, t } from "./i18n.js"
import { approvalModeNotice } from "./chat-presentation.js"
import { modelPresetArgument, parseReasoningEffort, parseThinkingMode } from "./model-actions.js"
import { enqueueMessage } from "./message-queue.js"
import type { ApprovalMode } from "../policy.js"
import type { SlashCommandContext } from "./slash-command-context.js"
import { APPROVAL_MODE_COMMAND, AUTH_COMMAND, BUG_COMMAND, EFFORT_COMMAND, EXIT_COMMAND, EXTENSIONS_COMMAND, HELP_COMMAND, LANGUAGE_COMMAND, MODEL_COMMAND, PERMISSIONS_COMMAND, PLAN_COMMAND, QUIT_COMMAND, STATUS_COMMAND, THINKING_COMMAND, TRUST_COMMAND, UNTRUST_COMMAND, commandArgument, commandWithArgument } from "./shortcut-command-policy.js"
import { HELP_TEXT_EN, HELP_TEXT_ZH } from "./slash-command-help.js"

export function executeGeneralSlashCommand(input: string, context: SlashCommandContext) {
  const { props, state, transcript, exit } = context
  if (input === EXIT_COMMAND || input === QUIT_COMMAND) { exit(); return true }
  if (input === HELP_COMMAND) {
    state.append({ kind: "info", text: state.activeLanguage === "zh" ? HELP_TEXT_ZH : HELP_TEXT_EN })
    return true
  }
  if (input === LANGUAGE_COMMAND) {
    state.append({ kind: "info", text: `${t(state.activeLanguage, "Current language")}: ${languageDisplay(state.activeLanguage, state.activeLanguage)}\n${t(state.activeLanguage, "Available languages")}: ${availableLanguagesText(state.activeLanguage)}\n${state.activeLanguage === "zh" ? "用法" : "Usage"}: ${languageUsageText()}` })
    return true
  }
  if (commandWithArgument(input, LANGUAGE_COMMAND)) {
    const requested = normalizeLanguage(commandArgument(input, LANGUAGE_COMMAND))
    if (!requested) state.append({ kind: "error", text: invalidLanguageText(state.activeLanguage) })
    else void state.runtimeStore.setLanguage(requested).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Language setting failed"), error, "language.switch", { requested }))
    return true
  }
  if (input === MODEL_COMMAND) {
    if (!state.runtimeStore.canSwitchModel) state.append({ kind: "error", text: state.activeLanguage === "zh" ? "当前客户端不支持模型切换。" : "This client does not support model switching." })
    else state.setActiveDialog({ kind: "model" })
    return true
  }
  if (input === AUTH_COMMAND) {
    if (!state.runtimeStore.canConfigureAuth) state.append({ kind: "error", text: state.activeLanguage === "zh" ? "当前客户端不支持模型配置。" : "This client does not support model configuration." })
    else state.setActiveDialog({ kind: "auth" })
    return true
  }
  if (commandWithArgument(input, MODEL_COMMAND)) {
    const argument = commandArgument(input, MODEL_COMMAND)
    const persist = /(?:^|\s)--persist\s*$/.test(argument)
    const preset = modelPresetArgument(argument.replace(/^(?:set\s+)?|(?:^|\s)--persist\s*$/g, ""))
    if (!preset) { state.append({ kind: "error", text: "Usage: /model set <model> [--persist]" }); return true }
    state.updateRunning(true); state.setActiveTool("Switching model")
    if (!state.runtimeStore.canSwitchModel) { state.append({ kind: "error", text: "This client does not support model switching." }); state.updateRunning(false); state.setActiveTool(null) }
    else void state.runtimeStore.switchModel(preset).then(async () => {
      if (!persist) return
      await state.runtimeStore.persistDefaultModel(preset)
      state.append({ kind: "info", text: state.activeLanguage === "zh" ? `已将 ${preset} 设为后续新会话的默认模型。` : `${preset} is now the default model for future sessions.` })
    }).catch((error) => transcript.appendReportedError("Model switch failed", error, "model.switch", { preset, persist })).finally(() => { state.updateRunning(false); state.setActiveTool(null) })
    return true
  }
  if (input === EFFORT_COMMAND) { state.append({ kind: "info", text: `Reasoning effort: ${state.activeEffort}\nAvailable: low, medium, high, xhigh, max\nUsage: /effort <level>` }); return true }
  if (commandWithArgument(input, EFFORT_COMMAND)) {
    const effort = parseReasoningEffort(commandArgument(input, EFFORT_COMMAND))
    if (!effort) state.append({ kind: "error", text: "Usage: /effort low|medium|high|xhigh|max" })
    else if (!state.runtimeStore.canSwitchEffort) state.append({ kind: "error", text: "This client does not support reasoning effort switching." })
    else void state.runtimeStore.switchEffort(effort).catch((error) => transcript.appendReportedError("Effort switch failed", error, "effort.switch", { effort }))
    return true
  }
  if (input === THINKING_COMMAND) { state.append({ kind: "info", text: state.activeLanguage === "zh" ? `思考模式：${state.activeThinkingMode}\n可选：auto（自动）、on（开启）、off（关闭）\n用法：/thinking <mode>` : `Thinking mode: ${state.activeThinkingMode}\nAvailable: auto, on, off\nUsage: /thinking <mode>` }); return true }
  if (commandWithArgument(input, THINKING_COMMAND)) {
    const mode = parseThinkingMode(commandArgument(input, THINKING_COMMAND))
    if (!mode) state.append({ kind: "error", text: state.activeLanguage === "zh" ? "用法：/thinking auto|on|off" : "Usage: /thinking auto|on|off" })
    else if (!state.runtimeStore.canSwitchThinking) state.append({ kind: "error", text: state.activeLanguage === "zh" ? "当前客户端不支持切换思考模式。" : "This client does not support thinking mode switching." })
    else void state.runtimeStore.switchThinking(mode).catch((error) => transcript.appendReportedError(state.activeLanguage === "zh" ? "思考模式切换失败" : "Thinking mode switch failed", error, "thinking.switch", { mode }))
    return true
  }
  if (input === EXTENSIONS_COMMAND) { state.append({ kind: "info", text: props.promptExtensions?.length ? props.promptExtensions.map((item) => `/${item.name}  [${item.kind} · ${item.source}] ${item.description}`).join("\n") : "No custom commands or skills are loaded." }); return true }
  if (commandWithArgument(input, BUG_COMMAND)) {
    const description = commandArgument(input, BUG_COMMAND) || "User captured the current bad case"
    state.updateRunning(true); state.setActiveTool("Collecting diagnostics")
    void props.reportError(new Error(description), "interactive.bad_case", "bad_case", { description }).then((report) => state.append({ kind: "info", text: `Bad case saved.\nError ID: ${report.id}\nLog: ${report.file}\nSend me this ID when you want to investigate it.` })).catch((error) => state.append({ kind: "error", text: `Failed to save bad case: ${error instanceof Error ? error.message : String(error)}` })).finally(() => { state.updateRunning(false); state.setActiveTool(null) })
    return true
  }
  if (input === STATUS_COMMAND) {
    void props.conversation.memorySources().then((sources) => { state.setMemoryCount(sources.length); state.append({ kind: "info", text: `Workspace: ${props.workspace}\nModel: ${state.activeModel}\nThinking mode: ${state.activeThinkingMode}\nReasoning effort: ${state.activeEffort}\nSession: ${state.activeSessionId}${state.activeSessionTitle ? ` · ${state.activeSessionTitle}` : ""}\nPlan mode: ${state.activePlanMode ? "on" : "off"}\nApproval mode: ${state.activeApprovalMode}\nTrusted workspace: ${state.trusted ? "yes" : "no"}\nContext messages: ${props.conversation.history().length}\nProject instructions: ${sources.length} source(s)` }) }).catch((error) => transcript.appendReportedError("Failed to read status", error, "status.read"))
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
    else if (!["ask", "auto", "full-access"].includes(requested)) state.append({ kind: "error", text: state.activeLanguage === "zh" ? "用法：/approval-mode [ask|auto|full-access]；计划模式请使用 /plan。" : "Usage: /approval-mode [ask|auto|full-access]; use /plan for planning." })
    else state.applyApprovalMode(requested as ApprovalMode)
    return true
  }
  if (input === TRUST_COMMAND || input === UNTRUST_COMMAND) {
    const next = input === TRUST_COMMAND
    void setWorkspaceTrusted(props.workspace, next).then(() => state.setTrusted(next)).catch((error) => transcript.appendReportedError("Failed to update workspace trust", error, "workspace.trust"))
    return true
  }
  return false
}
