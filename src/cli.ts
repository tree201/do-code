#!/usr/bin/env node
import { stdin, stdout, stderr } from "node:process"
import { parseArgs } from "./cli-args.js"
import { loadSession } from "./sessions.js"
import { loadStoredConfig, NoModelConfiguredError, rememberRecentModel, resolveAgentProfile, resolveRuntimeModelConfig, type RuntimeModelConfig } from "./config.js"
import { createChatModel, SwitchableModel } from "./model.js"
import { createWorktree } from "./worktree.js"
import { DEFAULT_MAX_TURNS } from "./turn-limits.js"
import { runCliCommand } from "./cli-commands.js"
import { handleCliError } from "./cli-errors.js"
import { runHeadless } from "./cli-headless.js"
import { t } from "./ui/i18n.js"

function unconfiguredModel(language: import("./config.js").DoCodeLanguage): RuntimeModelConfig {
  return {
    source: "config",
    sourceLabel: "not configured",
    preset: t(language, "Unconfigured model"),
    provider: "unconfigured",
    modelId: "unconfigured",
    baseUrl: "https://127.0.0.1.invalid/v1",
    apiKey: "unconfigured",
    reasoningEffort: "medium",
    effectiveReasoningEffort: "medium",
    thinkingMode: "auto",
    effectiveThinkingMode: "auto",
  }
}

function hasEnvironmentModel() {
  return Boolean(process.env.MODEL_API_KEY?.trim() && process.env.MODEL_BASE_URL?.trim() && process.env.MODEL_ID?.trim())
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.command === "version" || args.command === "update") {
    await runCliCommand(args)
    return
  }
  let createdWorktree: string | undefined
  if (args.worktree !== undefined) {
    const worktree = await createWorktree(args.workspace, args.worktree || undefined)
    args.workspace = worktree.directory
    createdWorktree = worktree.directory
  }
  if (await runCliCommand(args)) return

  const storedConfig = await loadStoredConfig(args.workspace)
  const resolvedConfig = args.language ? { ...storedConfig, language: args.language } : storedConfig
  const language = resolvedConfig.language ?? "en"
  if (createdWorktree) stderr.write(`${t(language, "Worktree: {directory}", { directory: createdWorktree })}\n`)
  const agentProfile = resolveAgentProfile(resolvedConfig, args.agent)
  if (agentProfile) {
    args.agent = agentProfile.name
    if (!args.model && agentProfile.model) args.model = agentProfile.model
    if (args.approvalMode === "ask" && agentProfile.approvalMode) {
      args.approvalMode = agentProfile.approvalMode
      args.yes = agentProfile.approvalMode === "full-access"
    }
    if (args.maxSteps === DEFAULT_MAX_TURNS && agentProfile.maxSteps) args.maxSteps = agentProfile.maxSteps
  }

  const headless = args.command === "run" || (args.command === "chat" && (Boolean(args.task || args.taskFile) || !stdin.isTTY))
  if ((args.command === "chat" || args.command === "resume") && !headless) {
    // Ink checks CI during module initialization, so normalize it before the dynamic import.
    if (stdin.isTTY && stdout.isTTY && process.env.CI) process.env.CI = "0"
    let modelConfig: RuntimeModelConfig
    try {
      const resumedModel = !args.model && !args.provider && !hasEnvironmentModel() && args.continueSession ? (await loadSession(args.workspace, args.sessionId)).session.model : undefined
      try {
        modelConfig = await resolveRuntimeModelConfig(args.workspace, args.model ?? resumedModel, args.provider, undefined, undefined, resolvedConfig)
      } catch (error) {
        if (!resumedModel || args.model) throw error
        modelConfig = await resolveRuntimeModelConfig(args.workspace, undefined, args.provider, undefined, undefined, resolvedConfig)
      }
      if (args.model) await rememberRecentModel({ providerID: modelConfig.provider, modelID: modelConfig.modelId })
    } catch (error) {
      if (!(error instanceof NoModelConfiguredError) || !stdin.isTTY || !stdout.isTTY) throw error
      modelConfig = unconfiguredModel(resolvedConfig.language ?? "en")
    }
    const { runInteractiveChat } = await import("./ui/chat-app.js")
    await runInteractiveChat(args, new SwitchableModel(modelConfig.preset, createChatModel(modelConfig)), modelConfig, resolvedConfig)
    return
  }

  await runHeadless(args, resolvedConfig, agentProfile)
}

main().catch(handleCliError)
