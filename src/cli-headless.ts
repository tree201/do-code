import { randomUUID } from "node:crypto"
import { createInterface } from "node:readline/promises"
import path from "node:path"
import { stdin, stdout, stderr } from "node:process"
import type { Args } from "./cli-args.js"
import { resolveHeadlessTask } from "./cli-task.js"
import { createChatModel } from "./model.js"
import { runAgentSession, type AgentTraceEvent } from "./session.js"
import { prepareSessionStorage, projectDataPath, sessionsRoot } from "./sessions.js"
import { approvalRequest, createPolicyEngine, type ApprovalChoice, type ToolApprovalRequest } from "./policy.js"
import { exitCodeForResult, streamEnvelope, traceEnvelope, HEADLESS_PROTOCOL_VERSION, type StreamEnvelope } from "./headless.js"
import { toolDefinitions } from "./tools.js"
import { reportError } from "./error-reports.js"
import { HookRunner } from "./hooks.js"
import { McpManager } from "./mcp.js"
import { createSandboxShellRunner, createSandboxShellSpawnSpec } from "./sandbox.js"
import { outputLanguageInstruction, resolveRuntimeModelConfig, type AgentProfileConfig, type DoCodeLanguage, type ResolvedConfig, type SandboxNetworkMode } from "./config.js"
import { t } from "./ui/i18n.js"

const SHELL_TOOL = "shell"

function logEvent(language: DoCodeLanguage, event: AgentTraceEvent) {
  if (event.type === "step.started") stderr.write(`\n${t(language, "[step {step}]", { step: event.step ?? "" })}\n`)
  if (event.type === "tool.started") stderr.write(`${t(language, "→ {tool} {args}", { tool: event.tool ?? "", args: JSON.stringify(event.args) })}\n`)
  if (event.type === "tool.completed") {
    const output = event.output ?? ""
    const preview = output.length > 500 ? `${output.slice(0, 500)}…` : output
    stderr.write(`${t(language, "{status} {tool}: {output}", { status: event.ok ? "✓" : "✗", tool: event.tool ?? "", output: preview })}\n`)
  }
}

async function terminalApproval(language: DoCodeLanguage, prompt: ReturnType<typeof createInterface>, request: ToolApprovalRequest): Promise<ApprovalChoice> {
  const answer = await prompt.question(`\n${request.title} [${request.risk}]\n${request.detail}\n${request.reason}\n${t(language, "1) once  2) session  3) always  4) deny")}\n${t(language, "[1-4, default 4]")} `)
  return answer.trim() === "1" ? "once" : answer.trim() === "2" ? "session" : answer.trim() === "3" ? "always" : "deny"
}

export async function readStdinTask() {
  let value = ""
  for await (const chunk of stdin) value += chunk.toString()
  return value.trim()
}

type NamedAgentProfile = AgentProfileConfig & { name: string }

export async function runHeadless(args: Args, resolvedConfig: ResolvedConfig, agentProfile: NamedAgentProfile | null) {
  const language = args.language ?? resolvedConfig.language ?? "en"
  const pipedTask = stdin.isTTY ? "" : await readStdinTask()
  const { task, imageReferences } = await resolveHeadlessTask(args, pipedTask, language)
  const runId = `run_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`
  await prepareSessionStorage(args.workspace)
  const sessionDirectory = path.join(sessionsRoot(args.workspace), runId)
  const modelConfig = await resolveRuntimeModelConfig(args.workspace, args.model, args.provider, undefined, undefined, resolvedConfig)
  const prompt = args.yes || !stdin.isTTY ? null : createInterface({ input: stdin, output: stderr })
  const policy = await createPolicyEngine(args.workspace, args.approvalMode, { headless: !prompt })
  const activeSandbox = () => policy.mode === "full-access" ? { type: "local" as const, network: "full" as const } : { ...resolvedConfig.sandbox, network: "full" as const }
  const spawnSpec = (command: string, network: SandboxNetworkMode = "none") => createSandboxShellSpawnSpec(args.workspace, activeSandbox(), command, network)
  const hookRunner = new HookRunner(args.workspace, resolvedConfig.hooks, 10_000, policy, spawnSpec)
  const mcpManager = new McpManager(args.workspace, resolvedConfig.mcpServers, policy)
  const externalTools = await mcpManager.load()
  const shellRunner = async (...runnerArgs: Parameters<ReturnType<typeof createSandboxShellRunner>>) => await createSandboxShellRunner(args.workspace, activeSandbox())(...runnerArgs)
  await hookRunner.fire("sessionStart", { mode: "headless", task, model: modelConfig.preset })
  const artifactDirectory = args.artifactDirectory ?? projectDataPath(args.workspace, "agent-runs", runId)
  const frozenConfig = {
    schemaVersion: 1,
    runId,
    frozenAt: new Date().toISOString(),
    taskSource: { argument: Boolean(args.task), file: args.taskFile ?? null, stdin: Boolean(pipedTask), images: imageReferences.map((reference) => reference.slice(1)) },
    workspace: args.workspace,
    model: { id: modelConfig.modelId, baseUrl: modelConfig.baseUrl, source: modelConfig.source },
    approvalMode: args.approvalMode,
    agentProfile: agentProfile?.name ?? null,
    maxSteps: args.maxSteps,
    timeoutSeconds: args.timeoutSeconds,
    outputFormat: args.outputFormat,
    tools: [...toolDefinitions.map((tool) => tool.function.name), ...externalTools.map((tool) => tool.definition.function.name)],
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
      attachmentDirectory: path.join(sessionDirectory, "attachments"),
      externalTools,
      profileInstructions: [outputLanguageInstruction(language), agentProfile?.instructions].filter(Boolean).join("\n\n"),
      ...(agentProfile?.tools?.allow ? { toolAllowList: agentProfile.tools.allow } : {}),
      ...(agentProfile?.tools?.deny ? { toolDenyList: agentProfile.tools.deny } : {}),
      policy,
      runShell: shellRunner,
      shellSpawnSpec: spawnSpec,
      beforeModelRequest: async (messages) => {
        const context = await hookRunner.context("beforeModel", { messages: messages.slice(-8) })
        if (context) messages.push({ role: "user", content: `Hook context:\n${context}` })
      },
      beforeTool: async (name, toolArgs) => await hookRunner.context("beforeTool", { name, args: toolArgs }),
      afterTool: async (name, toolArgs, result) => { await hookRunner.fire("afterTool", { name, args: toolArgs, result }) },
      ...(resolvedConfig.subagents?.enabled === false ? {} : { delegateTask: async (subtask: string) => {
        const subResult = await runAgentSession(subtask, { workspace: args.workspace, maxSteps: Math.min(args.maxSteps, 12), approvalMode: "ask", isPlanMode: () => true, model: createChatModel(modelConfig), profileInstructions: outputLanguageInstruction(language), approveShell: async () => false, approveTool: async () => false, timeoutMs: Math.min(args.timeoutSeconds * 1000, 180_000) })
        return subResult.finalAnswer ?? subResult.errorMessage ?? t(language, "The sub-agent returned no result")
      } }),
      approveShell: async (command) => prompt ? await terminalApproval(language, prompt, approvalRequest(SHELL_TOOL, { command }, policy.evaluate(SHELL_TOOL, { command }))) : "deny",
      approveTool: async (request: ToolApprovalRequest) => prompt ? await terminalApproval(language, prompt, request) : "deny",
      ...(prompt ? { askUser: async (question: string, options: string[]) => {
        const labels = options.length ? `\n${options.map((option, index) => `${index + 1}) ${option}`).join("\n")}` : ""
        const answer = await prompt.question(`\n${question}${labels}\n${t(language, "> ")}`)
        const selected = Number(answer.trim())
        return options.length && Number.isInteger(selected) && options[selected - 1] ? options[selected - 1]! : answer.trim()
      } } : {}),
      onEvent: (event) => {
        if (args.outputFormat === "stream-json") writeStream({ ...traceEnvelope(runId, event), sequence: streamSequence++ })
        else logEvent(language, event)
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
    if (args.outputFormat === "stream-json") writeStream(streamEnvelope(runId, streamSequence++, "result", output))
    else if (args.outputFormat === "json") stdout.write(`${JSON.stringify(output)}\n`)
    else {
      if (result.finalAnswer) stdout.write(`${result.finalAnswer}\n`)
      stderr.write(`${t(language, "Artifacts: {directory}", { directory: artifactDirectory })}\n`)
    }
    if (result.status === "failed" && args.outputFormat === "text") stderr.write(`${t(language, "do-code stopped: {message}", { message: result.errorMessage ?? "" })}${errorReport ? `\n${t(language, "Error ID: {id}", { id: errorReport.id })}\n${t(language, "View: do-code errors show {id}", { id: errorReport.id })}` : ""}\n`)
    await hookRunner.fire(result.status === "failed" ? "error" : "sessionEnd", { runId, result: { status: result.status, stopReason: result.stopReason, errorMessage: result.errorMessage } })
    process.exitCode = exitCode
  } finally {
    process.removeListener("SIGINT", interrupt)
    prompt?.close()
    mcpManager.close()
  }
}
