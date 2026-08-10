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

export async function runCliCommand(args: Args) {
  if (args.command === "version") process.stdout.write(`${DO_CODE_VERSION}\n`)
  else if (args.command === "update") {
    const result = args.updateAction === "install" ? await installUpdate(args.updateChannel ?? "stable") : await checkForUpdate(args.updateChannel ?? "stable")
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else if (args.command === "auth") await runProviderSetupWizard()
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
  if (args.configAction === "setup") return await runProviderSetupWizard()
  const stored = await loadStoredConfig(args.workspace)
  const runtime = await resolveRuntimeModelConfig(args.workspace, args.model, args.provider).catch(() => null)
  console.log(`Configuration layers: ${stored.sources.join(" → ") || "none"}\nConfiguration file: ${doCodeConfigPath()}\nConfiguration source: ${runtime?.sourceLabel ?? "not configured"}\nModel preset: ${runtime?.preset ?? "not configured"}\nModel ID: ${runtime?.modelId ?? "not configured"}\nAvailable presets: ${listModelPresets(stored).join(", ") || "none"}\nEndpoint: ${runtime?.baseUrl ?? "not configured"}\nAPI key: ${runtime ? "detected (hidden)" : "not detected"}`)
}

async function doctorCommand(args: Args) {
  const model = await resolveRuntimeModelConfig(args.workspace, args.model, args.provider).catch(() => null)
  const checks = await Promise.all(["node", "npm", "git", "rg"].map(async (command) => [command, Boolean(await runCommand("sh", ["-lc", `command -v ${command}`], args.workspace))] as const))
  const workspace = await runCommand("git", ["rev-parse", "--show-toplevel"], args.workspace)
  console.log(`do-code doctor\nRuntime: Node.js ${process.version} · ${process.platform}/${process.arch}\nExecutable: ${process.execPath}\nLauncher: ${process.env.DO_CODE_CLI ?? "development entry"}\nWorkspace: ${args.workspace}\nGit repository: ${workspace || "no"}\nModel configuration: ${model ? `${model.modelId} · ${model.source}` : "unavailable"}`)
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`)
  if (!model || checks.some(([, ok]) => !ok)) process.exitCode = 1
}

async function extensionsCommand(args: Args) {
  const config = await loadStoredConfig(args.workspace)
  const prompts = await loadPromptExtensions(args.workspace)
  console.log(`Prompt extensions: ${prompts.length}`)
  for (const item of prompts) console.log(`${item.kind}\t/${item.name}\t${item.source}\t${item.file}`)
  console.log(`MCP Servers：${Object.keys(config.mcpServers ?? {}).length}`)
  for (const [name, server] of Object.entries(config.mcpServers ?? {})) console.log(`mcp\t${name}\t${server.enabled === false ? "disabled" : "enabled"}\t${server.url ?? server.command}`)
  console.log(`Hooks：${Object.values(config.hooks ?? {}).reduce((total, commands) => total + (commands?.length ?? 0), 0)}`)
}

async function agentsCommand(args: Args) {
  const config = await loadStoredConfig(args.workspace)
  const entries = Object.entries(config.agents ?? {})
  if (!entries.length) return console.log("No agent profiles configured.")
  for (const [name, profile] of entries) console.log(`${name === config.defaultAgent ? "*" : " "}\t${name}\t${profile.model ?? config.defaultModel ?? "default model"}\t${profile.approvalMode ?? "ask"}\t${profile.instructions?.split(/\r?\n/)[0] ?? ""}`)
}

async function worktreesCommand(args: Args) {
  for (const item of await listWorktrees(args.workspace)) console.log(`${String(item.worktree ?? "")}\t${String(item.branch ?? item.detached ?? "")}`)
}

async function sessionsCommand(args: Args) {
  if (args.sessionAction === "delete") {
    await deleteSession(args.workspace, args.sessionId!)
    return console.log(`Deleted session: ${args.sessionId}`)
  }
  if (args.sessionAction === "rename") {
    const renamed = await renameSession(args.workspace, args.sessionId!, args.sessionTitle!)
    return console.log(`Renamed: ${renamed.id} → ${renamed.title}`)
  }
  if (args.sessionAction === "export") {
    const file = await exportSession(args.workspace, args.sessionId!, args.exportFormat, args.output)
    return console.log(`Exported: ${file}`)
  }
  const sessions = args.sessionAction === "search" ? await searchSessions(args.workspace, args.sessionQuery!) : await listSessions(args.workspace)
  if (!sessions.length) return console.log(args.sessionAction === "search" ? "No matching sessions." : `This project has no sessions: ${sessionsRoot(args.workspace)}`)
  for (const session of sessions) console.log(`${session.id}\t${session.updatedAt}\t${session.title ?? "Untitled session"}\t${session.model ?? "Unknown model"}`)
}

async function errorsCommand(args: Args) {
  if (args.errorAction === "show") return console.log(formatErrorReport(await loadErrorReport(args.errorId!, args.workspace)))
  const reports = await listErrorReports()
  if (!reports.length) return console.log("No error reports yet.")
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
