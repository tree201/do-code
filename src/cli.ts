#!/usr/bin/env node
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import path from "node:path"
import { stdin, stdout, stderr } from "node:process"
import { parseArgs, type Args } from "./cli-args.js"
import { doCodeConfigPath, importOpenCodeConfig, listModelPresets, loadStoredConfig, openCodeConfigPath, resolveAgentProfile, resolveRuntimeModelConfig, type SandboxNetworkMode } from "./config.js"
import { createChatModel, SwitchableModel } from "./model.js"
import { runAgentSession, type AgentTraceEvent } from "./session.js"
import { deleteSession, exportSession, listSessions, renameSession, searchSessions, sessionsRoot } from "./sessions.js"
import { approvalRequest, createPolicyEngine, type ApprovalChoice, type ToolApprovalRequest } from "./policy.js"
import { EXIT_CODES, exitCodeForResult, streamEnvelope, traceEnvelope, HEADLESS_PROTOCOL_VERSION, type StreamEnvelope } from "./headless.js"
import { toolDefinitions } from "./tools.js"
import { formatErrorReport, listErrorReports, loadErrorReport, reportError } from "./error-reports.js"
import { loadPromptExtensions } from "./extension-registry.js"
import { HookRunner } from "./hooks.js"
import { McpManager } from "./mcp.js"
import { createSandboxShellRunner, createSandboxShellSpawnSpec } from "./sandbox.js"
import { createWorktree, listWorktrees } from "./worktree.js"
import { runAcpServer } from "./acp.js"
import { DO_CODE_VERSION } from "./version.js"
import { checkForUpdate, installUpdate } from "./update.js"
import { DEFAULT_MAX_TURNS } from "./turn-limits.js"
import { runProviderSetupWizard } from "./provider-setup-cli.js"

function logEvent(event: AgentTraceEvent) {
  if (event.type === "step.started") process.stderr.write(`\n[step ${event.step}]\n`)
  if (event.type === "tool.started") process.stderr.write(`→ ${event.tool} ${JSON.stringify(event.args)}\n`)
  if (event.type === "tool.completed") {
    const output = event.output ?? ""
    const preview = output.length > 500 ? `${output.slice(0, 500)}…` : output
    process.stderr.write(`${event.ok ? "✓" : "✗"} ${event.tool}: ${preview}\n`)
  }
}

async function terminalApproval(prompt: ReturnType<typeof createInterface>, request: ToolApprovalRequest): Promise<ApprovalChoice> {
  const answer = await prompt.question(`\n${request.title} [${request.risk}]\n${request.detail}\n${request.reason}\n1) once  2) session  3) always  4) deny\n[1-4, default 4] `)
  return answer.trim() === "1" ? "once" : answer.trim() === "2" ? "session" : answer.trim() === "3" ? "always" : "deny"
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if(args.command==="version"){stdout.write(`${DO_CODE_VERSION}\n`);return}
  if(args.command==="update"){
    const result=args.updateAction==="install"?await installUpdate(args.updateChannel??"stable"):await checkForUpdate(args.updateChannel??"stable")
    stdout.write(`${JSON.stringify(result,null,2)}\n`);return
  }
  if(args.worktree!==undefined){
    const worktree=await createWorktree(args.workspace,args.worktree||undefined)
    args.workspace=worktree.directory
    stderr.write(`Worktree: ${worktree.directory}\n`)
  }
  if(args.command==="auth"){await runProviderSetupWizard();return}
  if(args.command==="config"){await configCommand(args);return}
  if(args.command==="doctor"){await doctorCommand(args);return}
  if(args.command==="sessions"){await sessionsCommand(args);return}
  if(args.command==="errors"){await errorsCommand(args);return}
  if(args.command==="extensions"){await extensionsCommand(args);return}
  if(args.command==="agents"){await agentsCommand(args);return}
  if(args.command==="worktrees"){await worktreesCommand(args);return}
  if(args.command==="acp"){await runAcpServer(args);return}
  const resolvedConfig=await loadStoredConfig(args.workspace)
  const agentProfile=resolveAgentProfile(resolvedConfig,args.agent)
  if(agentProfile){
    args.agent=agentProfile.name
    if(!args.model&&agentProfile.model)args.model=agentProfile.model
    if(args.approvalMode==="ask"&&agentProfile.approvalMode){args.approvalMode=agentProfile.approvalMode;args.yes=agentProfile.approvalMode==="full-access"}
    if(args.maxSteps===DEFAULT_MAX_TURNS&&agentProfile.maxSteps)args.maxSteps=agentProfile.maxSteps
  }
  const headless = args.command === "run" || (args.command === "chat" && (Boolean(args.task || args.taskFile) || !stdin.isTTY))
  if ((args.command === "chat" || args.command === "resume") && !headless) {
    // Ink deliberately switches to a log-only renderer when CI is set. That
    // is right for non-interactive CI logs, but this process has a real PTY
    // (the browser terminal and our PTY integration tests both use one), so
    // it must retain the normal interactive composer. Do this before loading
    // Ink, because `is-in-ci` is evaluated during Ink's module initialization.
    if (stdin.isTTY && stdout.isTTY && process.env.CI) process.env.CI = "0"
    let modelConfig
    try { modelConfig=await resolveRuntimeModelConfig(args.workspace,args.model,args.provider) }
    catch(error){
      if(!(error instanceof Error)||!error.message.startsWith("No model is configured")||!stdin.isTTY||!stdout.isTTY)throw error
      stderr.write("尚未配置模型，先完成一次引导配置。\n")
      await runProviderSetupWizard()
      modelConfig=await resolveRuntimeModelConfig(args.workspace,args.model,args.provider)
    }
    const { runInteractiveChat } = await import("./ui/chat-app.js")
    await runInteractiveChat(args,new SwitchableModel(modelConfig.preset,createChatModel(modelConfig)),modelConfig)
    return
  }

  const pipedTask = stdin.isTTY ? "" : await readStdin()
  const explicitTask = args.taskFile ? (await readFile(args.taskFile, "utf8")).trim() : (args.task ?? "").trim()
  const imageReferences=(args.images??[]).map((image)=>{
    const absolute=path.resolve(args.workspace,image),relative=path.relative(args.workspace,absolute)
    if(relative===".."||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error(`Image must be inside the workspace: ${image}`)
    return `@${relative}`
  })
  const task = [[pipedTask, explicitTask].filter(Boolean).join("\n\n"),imageReferences.join(" ")].filter(Boolean).join("\n")
  if (!task) throw new Error("Task must not be empty")
  const modelConfig=await resolveRuntimeModelConfig(args.workspace,args.model,args.provider)
  const prompt = args.yes || !stdin.isTTY ? null : createInterface({ input: stdin, output: stderr })
  const policy = await createPolicyEngine(args.workspace, args.approvalMode, { headless: !prompt })
  const activeSandbox=()=>policy.mode==="full-access"?{type:"local" as const,network:"full" as const}:{...resolvedConfig.sandbox,network:"full" as const}
  const spawnSpec=(command:string,network:SandboxNetworkMode="none")=>createSandboxShellSpawnSpec(args.workspace,activeSandbox(),command,network)
  const hookRunner=new HookRunner(args.workspace,resolvedConfig.hooks,10_000,policy,spawnSpec)
  const mcpManager=new McpManager(args.workspace,resolvedConfig.mcpServers,policy)
  const externalTools=await mcpManager.load()
  const shellRunner=async (...runnerArgs:Parameters<ReturnType<typeof createSandboxShellRunner>>)=>await createSandboxShellRunner(args.workspace,activeSandbox())(...runnerArgs)
  await hookRunner.fire("sessionStart",{mode:"headless",task,model:modelConfig.preset})
  const runId = `run_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`
  const artifactDirectory = args.artifactDirectory ?? path.resolve(args.workspace, ".do-code/agent-runs", runId)
  const frozenConfig = {
    schemaVersion: 1,
    runId,
    frozenAt: new Date().toISOString(),
    taskSource: { argument: Boolean(args.task), file: args.taskFile ?? null, stdin: Boolean(pipedTask), images: args.images ?? [] },
    workspace: args.workspace,
    model: { id: modelConfig.modelId, baseUrl: modelConfig.baseUrl, source: modelConfig.source },
    approvalMode: args.approvalMode,
    agentProfile: agentProfile?.name ?? null,
    maxSteps: args.maxSteps,
    timeoutSeconds: args.timeoutSeconds,
    outputFormat: args.outputFormat,
    tools: [...toolDefinitions.map((tool) => tool.function.name),...externalTools.map((tool)=>tool.definition.function.name)],
    permissions: policy.snapshot(),
  }
  let streamSequence = 0
  const writeStream = (envelope: StreamEnvelope) => stdout.write(`${JSON.stringify(envelope)}\n`)
  if (args.outputFormat === "stream-json") writeStream(streamEnvelope(runId, streamSequence++, "system.init", frozenConfig))
  const controller = new AbortController()
  const interrupt = () => controller.abort(new DOMException("Interrupted", "AbortError"))
  process.once("SIGINT", interrupt)
  try {
    const result = await runAgentSession(task, {
      workspace: args.workspace,
      maxSteps: args.maxSteps,
      approvalMode: args.approvalMode,
      model: createChatModel(modelConfig),
      externalTools,
      ...(agentProfile?.instructions?{profileInstructions:agentProfile.instructions}:{}),
      ...(agentProfile?.tools?.allow?{toolAllowList:agentProfile.tools.allow}:{}),
      ...(agentProfile?.tools?.deny?{toolDenyList:agentProfile.tools.deny}:{}),
      policy,
      runShell:shellRunner,
      shellSpawnSpec:spawnSpec,
      beforeModelRequest:async(messages)=>{
        const context=await hookRunner.context("beforeModel",{messages:messages.slice(-8)})
        if(context)messages.push({role:"user",content:`Hook context:\n${context}`})
      },
      beforeTool:async(name,toolArgs)=>await hookRunner.context("beforeTool",{name,args:toolArgs}),
      afterTool:async(name,toolArgs,result)=>{await hookRunner.fire("afterTool",{name,args:toolArgs,result})},
      ...(resolvedConfig.subagents?.enabled===false?{}:{delegateTask:async(subtask:string)=>{
        const subResult=await runAgentSession(subtask,{workspace:args.workspace,maxSteps:Math.min(args.maxSteps,12),approvalMode:"ask",isPlanMode:()=>true,model:createChatModel(modelConfig),approveShell:async()=>false,approveTool:async()=>false,timeoutMs:Math.min(args.timeoutSeconds*1000,180_000)})
        return subResult.finalAnswer??subResult.errorMessage??"The sub-agent returned no result"
      }}),
      approveShell: async (command) => {
        if (!prompt) return "deny"
        return await terminalApproval(prompt, approvalRequest("shell", { command }, policy.evaluate("shell", { command })))
      },
      approveTool: async (request: ToolApprovalRequest) => {
        if (!prompt) return "deny"
        return await terminalApproval(prompt, request)
      },
      ...(prompt ? { askUser: async (question: string, options: string[]) => {
        const labels = options.length ? `\n${options.map((option, index) => `${index + 1}) ${option}`).join("\n")}` : ""
        const answer = await prompt.question(`\n${question}${labels}\n> `)
        const selected = Number(answer.trim())
        return options.length && Number.isInteger(selected) && options[selected - 1] ? options[selected - 1]! : answer.trim()
      } } : {}),
      onEvent: (event) => {
        if (args.outputFormat === "stream-json") writeStream({ ...traceEnvelope(runId, event), sequence: streamSequence++ })
        else logEvent(event)
      },
      artifactDirectory,
      timeoutMs: args.timeoutSeconds * 1000,
      signal: controller.signal,
      frozenConfig,
      requireVerification: true,
    })
    const exitCode = exitCodeForResult(result)
    const errorReport = result.status === "failed" && result.stopReason !== "interrupted" ? await reportError({
      error: new Error(result.errorMessage ?? result.stopReason), workspace: args.workspace, operation: "headless.run",
      model: modelConfig.modelId, context: { runId, artifactDirectory, frozenConfig, result: { ...result, events: result.events.slice(-100), patch: `[${Buffer.byteLength(result.patch)} bytes; stored in artifact]` } },
    }) : null
    const output = { protocolVersion: HEADLESS_PROTOCOL_VERSION, runId, artifactDirectory, exitCode, ...(errorReport ? { errorId: errorReport.id } : {}), ...result }
    if (args.outputFormat === "stream-json") {
      writeStream(streamEnvelope(runId, streamSequence++, "result", output))
    } else if (args.outputFormat === "json") {
      stdout.write(`${JSON.stringify(output)}\n`)
    } else {
      if (result.finalAnswer) stdout.write(`${result.finalAnswer}\n`)
      stderr.write(`Artifacts: ${artifactDirectory}\n`)
    }
    if (result.status === "failed" && args.outputFormat === "text") stderr.write(`do-code stopped: ${result.errorMessage}${errorReport ? `\nError ID: ${errorReport.id}\nView: do-code errors show ${errorReport.id}` : ""}\n`)
    await hookRunner.fire(result.status==="failed"?"error":"sessionEnd",{runId,result:{status:result.status,stopReason:result.stopReason,errorMessage:result.errorMessage}})
    process.exitCode = exitCode
  } finally {
    process.removeListener("SIGINT", interrupt)
    prompt?.close()
    mcpManager.close()
  }
}

async function readStdin() {
  let value = ""
  for await (const chunk of stdin) value += chunk.toString()
  return value.trim()
}

async function configCommand(args:Args){
  if(args.configAction==="setup"){await runProviderSetupWizard();return}
  if(args.configAction==="import"){
    const imported=await importOpenCodeConfig()
    console.log(`Imported OpenCode configuration\nModel: ${imported.runtime.modelId}\nEndpoint: ${imported.runtime.baseUrl}\nConfiguration: ${imported.file}\nThe API key was not written to the do-code configuration.`)
    return
  }
  const stored=await loadStoredConfig(args.workspace),runtime=await resolveRuntimeModelConfig(args.workspace,args.model,args.provider).catch(()=>null)
  console.log(`Configuration layers: ${stored.sources.join(" → ")||"none"}\nConfiguration file: ${doCodeConfigPath()}\nConfiguration source: ${runtime?.sourceLabel??(stored.model?.source||"not configured")}\nModel preset: ${runtime?.preset??"not configured"}\nModel ID: ${runtime?.modelId??"not configured"}\nAvailable presets: ${listModelPresets(stored).join(", ")||"none"}\nEndpoint: ${runtime?.baseUrl??"not configured"}\nAPI key: ${runtime?"detected (hidden)":"not detected"}\nOpenCode: ${openCodeConfigPath()}`)
}

async function doctorCommand(args:Args){
  const model=await resolveRuntimeModelConfig(args.workspace,args.model,args.provider).catch(()=>null)
  const checks=await Promise.all(["node","npm","git","rg"].map(async(command)=>[command,Boolean(await runCommand("sh",["-lc",`command -v ${command}`],args.workspace))] as const))
  const workspace=await runCommand("git",["rev-parse","--show-toplevel"],args.workspace)
  console.log(`do-code doctor\nRuntime: Node.js ${process.version} · ${process.platform}/${process.arch}\nExecutable: ${process.execPath}\nLauncher: ${process.env.DO_CODE_CLI??"development entry"}\nWorkspace: ${args.workspace}\nGit repository: ${workspace||"no"}\nModel configuration: ${model?`${model.modelId} · ${model.source}`:"unavailable"}`)
  for(const[name,ok]of checks)console.log(`${ok?"✓":"✗"} ${name}`)
  if(!model||checks.some(([,ok])=>!ok))process.exitCode=1
}

async function extensionsCommand(args:Args){
  const config=await loadStoredConfig(args.workspace)
  const prompts=await loadPromptExtensions(args.workspace)
  console.log(`Prompt extensions: ${prompts.length}`)
  for(const item of prompts)console.log(`${item.kind}\t/${item.name}\t${item.source}\t${item.file}`)
  console.log(`MCP Servers：${Object.keys(config.mcpServers??{}).length}`)
  for(const[name,server]of Object.entries(config.mcpServers??{}))console.log(`mcp\t${name}\t${server.enabled===false?"disabled":"enabled"}\t${server.url??server.command}`)
  console.log(`Hooks：${Object.values(config.hooks??{}).reduce((total,commands)=>total+(commands?.length??0),0)}`)
}

async function agentsCommand(args:Args){
  const config=await loadStoredConfig(args.workspace)
  const entries=Object.entries(config.agents??{})
  if(!entries.length){console.log("No agent profiles configured.");return}
  for(const[name,profile]of entries)console.log(`${name===config.defaultAgent?"*":" "}\t${name}\t${profile.model??config.defaultModel??"default model"}\t${profile.approvalMode??"ask"}\t${profile.instructions?.split(/\r?\n/)[0]??""}`)
}

async function worktreesCommand(args:Args){
  for(const item of await listWorktrees(args.workspace))console.log(`${String(item.worktree??"")}\t${String(item.branch??item.detached??"")}`)
}

async function sessionsCommand(args:Args){
  if(args.sessionAction==="delete"){
    await deleteSession(args.workspace,args.sessionId!)
    console.log(`Deleted session: ${args.sessionId}`)
    return
  }
  if(args.sessionAction==="rename"){
    const renamed=await renameSession(args.workspace,args.sessionId!,args.sessionTitle!)
    console.log(`Renamed: ${renamed.id} → ${renamed.title}`)
    return
  }
  if(args.sessionAction==="export"){
    const file=await exportSession(args.workspace,args.sessionId!,args.exportFormat,args.output)
    console.log(`Exported: ${file}`)
    return
  }
  const sessions=args.sessionAction==="search"?await searchSessions(args.workspace,args.sessionQuery!):await listSessions(args.workspace)
  if(!sessions.length){console.log(args.sessionAction==="search"?"No matching sessions.":`This project has no sessions: ${sessionsRoot(args.workspace)}`);return}
  for(const session of sessions)console.log(`${session.id}\t${session.updatedAt}\t${session.title??"Untitled session"}\t${session.model??"Unknown model"}`)
}

async function errorsCommand(args:Args){
  if(args.errorAction==="show"){
    console.log(formatErrorReport(await loadErrorReport(args.errorId!,args.workspace)))
    return
  }
  const reports=await listErrorReports()
  if(!reports.length){console.log("No error reports yet.");return}
  for(const report of reports)console.log(`${report.id}\t${report.createdAt}\t${report.category}\t${report.operation}\t${report.message.replace(/\s+/g," ").slice(0,100)}`)
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

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error)
  const argv = process.argv.slice(2)
  const formatIndex = argv.indexOf("--output-format")
  const requestedFormat = formatIndex >= 0 ? argv[formatIndex + 1] : undefined
  const format = argv.includes("--json") || requestedFormat === "json" ? "json" : requestedFormat === "stream-json" ? "stream-json" : "text"
  const exitCode = /task|argument|requires|must be|usage|unknown/i.test(message) ? EXIT_CODES.argument : /model|api key|endpoint|fetch/i.test(message) ? EXIT_CODES.model : EXIT_CODES.unknown
  const report = await reportError({ error, workspace: process.cwd(), operation: "cli.main", context: { argv: process.argv.slice(2) } })
  if (format === "stream-json") stdout.write(`${JSON.stringify(streamEnvelope(`run_error_${Date.now().toString(36)}`, 0, "result", { status: "failed", stopReason: exitCode === EXIT_CODES.model ? "model_error" : "unknown_error", errorMessage: message, errorId:report.id, exitCode }))}\n`)
  else if (format === "json") stdout.write(`${JSON.stringify({ protocolVersion: HEADLESS_PROTOCOL_VERSION, status: "failed", errorMessage: message, errorId:report.id, exitCode })}\n`)
  else stderr.write(`do-code: ${message}\nError ID: ${report.id}\nView: do-code errors show ${report.id}\n`)
  process.exitCode = exitCode
})
