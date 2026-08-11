import { spawn } from "node:child_process"
import type { Args } from "./cli-args.js"
import { doCodeConfigPath, listModelPresets, loadStoredConfig, resolveRuntimeModelConfig } from "./config.js"
import { formatErrorReport, listErrorReports, loadErrorReport } from "./error-reports.js"
import { loadPromptExtensions } from "./extension-registry.js"
import { deleteSession, exportSession, listSessions, renameSession, searchSessions, sessionsRoot } from "./sessions.js"
import { listWorktrees } from "./worktree.js"
import { DO_CODE_VERSION } from "./version.js"
import { checkForUpdate, installUpdate } from "./update.js"
import { runProviderSetupWizard } from "./provider-setup-cli.js"
import { runAcpServer } from "./acp.js"
import { t } from "./ui/i18n.js"

export async function runCliCommand(args: Args) {
  if (args.command === "version") process.stdout.write(`${DO_CODE_VERSION}\n`)
  else if (args.command === "update") {
    const stored = await loadStoredConfig(args.workspace)
    const language = args.language ?? stored.language ?? "en"
    const result = args.updateAction === "install" ? await installUpdate(args.updateChannel ?? "stable", language) : await checkForUpdate(args.updateChannel ?? "stable", fetch, language)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else if (args.command === "auth") await runProviderSetupWizard(args.language)
  else if (args.command === "config") await configCommand(args)
  else if (args.command === "doctor") await doctorCommand(args)
  else if (args.command === "sessions") await sessionsCommand(args)
  else if (args.command === "errors") await errorsCommand(args)
  else if (args.command === "extensions") await extensionsCommand(args)
  else if (args.command === "agents") await agentsCommand(args)
  else if (args.command === "worktrees") await worktreesCommand(args)
  else if (args.command === "acp") await runAcpServer(args)
  else return false
  return true
}

async function configCommand(args: Args) {
  if (args.configAction === "setup") return await runProviderSetupWizard(args.language)
  const stored = await loadStoredConfig(args.workspace)
  const language = args.language ?? stored.language ?? "en"
  const runtime = await resolveRuntimeModelConfig(args.workspace, args.model, args.provider, undefined, undefined, args.language ? { ...stored, language: args.language } : stored).catch(() => null)
  console.log(`${t(language, "Configuration layers")}: ${stored.sources.join(" → ") || t(language, "none")}\n${t(language, "Configuration file")}: ${doCodeConfigPath()}\n${t(language, "Configuration source")}: ${runtime?.sourceLabel ?? t(language, "not configured")}\n${t(language, "Model preset")}: ${runtime?.preset ?? t(language, "not configured")}\n${t(language, "Model ID")}: ${runtime?.modelId ?? t(language, "not configured")}\n${t(language, "Available presets")}: ${listModelPresets(stored).join(", ") || t(language, "none")}\n${t(language, "Endpoint")}: ${runtime?.baseUrl ?? t(language, "not configured")}\n${t(language, "API key")}: ${runtime ? t(language, "detected (hidden)") : t(language, "not detected")}`)
}

async function doctorCommand(args: Args) {
  const stored = await loadStoredConfig(args.workspace)
  const language = args.language ?? stored.language ?? "en"
  const model = await resolveRuntimeModelConfig(args.workspace, args.model, args.provider, undefined, undefined, args.language ? { ...stored, language: args.language } : stored).catch(() => null)
  const checks = await Promise.all(["node", "npm", "git", "rg"].map(async (command) => [command, Boolean(await runCommand("sh", ["-lc", `command -v ${command}`], args.workspace))] as const))
  const workspace = await runCommand("git", ["rev-parse", "--show-toplevel"], args.workspace)
  console.log(`${t(language, "do-code doctor")}\n${t(language, "Runtime")}: Node.js ${process.version} · ${process.platform}/${process.arch}\n${t(language, "Executable")}: ${process.execPath}\n${t(language, "Launcher")}: ${process.env.DO_CODE_CLI ?? t(language, "development entry")}\n${t(language, "Workspace")}: ${args.workspace}\n${t(language, "Git repository")}: ${workspace || t(language, "no")}\n${t(language, "Model configuration")}: ${model ? `${model.modelId} · ${model.source}` : t(language, "unavailable")}`)
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`)
  if (!model || checks.some(([, ok]) => !ok)) process.exitCode = 1
}

async function extensionsCommand(args: Args) {
  const config = await loadStoredConfig(args.workspace)
  const language = args.language ?? config.language ?? "en"
  const prompts = await loadPromptExtensions(args.workspace)
  console.log(`${t(language, "Prompt extensions")}: ${prompts.length}`)
  for (const item of prompts) console.log(`${item.kind}\t/${item.name}\t${item.source}\t${item.file}`)
  console.log(`${t(language, "MCP Servers")}：${Object.keys(config.mcpServers ?? {}).length}`)
  for (const [name, server] of Object.entries(config.mcpServers ?? {})) console.log(`mcp\t${name}\t${server.enabled === false ? "disabled" : "enabled"}\t${server.url ?? server.command}`)
  console.log(`${t(language, "Hooks")}：${Object.values(config.hooks ?? {}).reduce((total, commands) => total + (commands?.length ?? 0), 0)}`)
}

async function agentsCommand(args: Args) {
  const config = await loadStoredConfig(args.workspace)
  const language = args.language ?? config.language ?? "en"
  const entries = Object.entries(config.agents ?? {})
  if (!entries.length) return console.log(t(language, "No agent profiles configured."))
  for (const [name, profile] of entries) console.log(`${name === config.defaultAgent ? "*" : " "}\t${name}\t${profile.model ?? config.defaultModel ?? "default model"}\t${profile.approvalMode ?? "ask"}\t${profile.instructions?.split(/\r?\n/)[0] ?? ""}`)
}

async function worktreesCommand(args: Args) {
  for (const item of await listWorktrees(args.workspace)) console.log(`${String(item.worktree ?? "")}\t${String(item.branch ?? item.detached ?? "")}`)
}

async function sessionsCommand(args: Args) {
  const stored = await loadStoredConfig(args.workspace)
  const language = args.language ?? stored.language ?? "en"
  if (args.sessionAction === "delete") {
    await deleteSession(args.workspace, args.sessionId!)
    return console.log(t(language, "Deleted session: {id}", { id: args.sessionId! }))
  }
  if (args.sessionAction === "rename") {
    const renamed = await renameSession(args.workspace, args.sessionId!, args.sessionTitle!)
    return console.log(t(language, "Renamed: {id} → {title}", { id: renamed.id, title: renamed.title }))
  }
  if (args.sessionAction === "export") {
    const file = await exportSession(args.workspace, args.sessionId!, args.exportFormat, args.output)
    return console.log(t(language, "Exported: {file}", { file }))
  }
  const sessions = args.sessionAction === "search" ? await searchSessions(args.workspace, args.sessionQuery!) : await listSessions(args.workspace)
  if (!sessions.length) return console.log(args.sessionAction === "search" ? t(language, "No matching sessions.") : `${t(language, "This project has no sessions")}: ${sessionsRoot(args.workspace)}`)
  for (const session of sessions) console.log(`${session.id}\t${session.updatedAt}\t${session.title ?? t(language, "Untitled session")}\t${session.model ?? t(language, "Unknown model")}`)
}

async function errorsCommand(args: Args) {
  const stored = await loadStoredConfig(args.workspace)
  const language = args.language ?? stored.language ?? "en"
  if (args.errorAction === "show") return console.log(formatErrorReport(await loadErrorReport(args.errorId!, args.workspace), language))
  const reports = await listErrorReports()
  if (!reports.length) return console.log(t(language, "No error reports yet."))
  for (const report of reports) console.log(`${report.id}\t${report.createdAt}\t${report.category}\t${report.operation}\t${report.message.replace(/\s+/g, " ").slice(0, 100)}`)
}

function runCommand(command: string, args: string[], cwd: string) {
  return new Promise<string>((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.on("error", (error) => resolve(error.message))
    child.on("close", () => resolve(output.trim()))
  })
}
