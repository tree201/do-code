import path from "node:path"
import { BackgroundProcessManager } from "./background-processes.js"
import { approved } from "./policy-approval.js"
import { shellNetworkMode } from "./policy-classification.js"
import type { ToolContext, ToolImplementation } from "./tool-contracts.js"
import { toolSchema } from "./tool-definition-helpers.js"
import { optionalBoolean, optionalNumber, optionalText, text, truncateToolOutput } from "./tool-input.js"
import { defaultShellSpawnSpec, runShellCommand } from "./tool-shell.js"
import { TOOL_NAMES } from "./tool-names.js"
import { boundedOutput } from "./bounded-output.js"

const fallbackProcessManagers = new Map<string, BackgroundProcessManager>()

function processManager(context: ToolContext) {
  if (context.processManager) return context.processManager
  const workspace = path.resolve(context.workspace)
  const current = fallbackProcessManagers.get(workspace) ?? new BackgroundProcessManager()
  fallbackProcessManagers.set(workspace, current)
  return current
}

const shellTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.SHELL,
    description: "Run a shell command in the workspace. Use this for tests, builds, and repository inspection.",
    parameters: toolSchema({ command: { type: "string" }, timeout_ms: { type: "integer", minimum: 1000, maximum: 600000 } }, ["command"]),
  } },
  async execute(args, context) {
    const command = text(args, "command")
    const timeout = optionalNumber(args, "timeout_ms") ?? 120_000
    if (!context.policy && !context.approvalMode && !approved(await context.approveShell(command))) return { ok: false, output: "Shell command was declined by the user" }
    if (context.runShell) {
      const result = await context.runShell(command, Math.min(timeout, 600_000), context.onToolOutput, context.signal, shellNetworkMode(command))
      return { ...result, output: boundedOutput(result.output) }
    }
    const result = await runShellCommand(process.env.SHELL ?? "/bin/sh", ["-lc", command], context.workspace, Math.min(timeout, 600_000), [0], context.onToolOutput, context.signal)
    return { ...result, output: truncateToolOutput(result.output) }
  },
}

const shellStartTool: ToolImplementation = {
  definition: { type: "function", function: { name: TOOL_NAMES.SHELL_START, description: "Start a long-running shell command in the background and return a job ID.", parameters: toolSchema({ command: { type: "string" } }, ["command"]) } },
  async execute(args, context) {
    const command = text(args, "command")
    return { ok: true, output: JSON.stringify(processManager(context).start(command, defaultShellSpawnSpec(context, command, shellNetworkMode(command)))) }
  },
}

const shellPtyStartTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.SHELL_PTY_START,
    description: "Start an interactive terminal command in a real PTY. Use for REPLs, debuggers, terminal UIs, password prompts, and commands that require terminal capabilities.",
    parameters: toolSchema({ command: { type: "string" }, columns: { type: "integer", minimum: 20, maximum: 500 }, rows: { type: "integer", minimum: 5, maximum: 200 } }, ["command"]),
  } },
  async execute(args, context) {
    const command = text(args, "command")
    const started = await processManager(context).startPty(command, defaultShellSpawnSpec(context, command, shellNetworkMode(command)), optionalNumber(args, "columns") ?? 120, optionalNumber(args, "rows") ?? 30)
    return { ok: true, output: JSON.stringify(started) }
  },
}

const shellStatusTool: ToolImplementation = {
  definition: { type: "function", function: { name: TOOL_NAMES.SHELL_STATUS, description: "Read background shell job status and recent output.", parameters: toolSchema({ job_id: { type: "string" }, lines: { type: "integer", minimum: 1, maximum: 1000 }, delay_ms: { type: "integer", minimum: 0, maximum: 5000 } }, []) } },
  async execute(args, context) { return await processManager(context).status(optionalText(args, "job_id"), optionalNumber(args, "lines") ?? 100, optionalNumber(args, "delay_ms") ?? 0) },
}

const shellSendTool: ToolImplementation = {
  definition: { type: "function", function: { name: TOOL_NAMES.SHELL_SEND, description: "Send text or a response to a running background shell or PTY job.", parameters: toolSchema({ job_id: { type: "string" }, input: { type: "string" }, submit: { type: "boolean" } }, ["job_id", "input"]) } },
  async execute(args, context) { return processManager(context).send(text(args, "job_id"), text(args, "input"), optionalBoolean(args, "submit") ?? true) },
}

const shellResizeTool: ToolImplementation = {
  definition: { type: "function", function: { name: TOOL_NAMES.SHELL_RESIZE, description: "Resize a running PTY job.", parameters: toolSchema({ job_id: { type: "string" }, columns: { type: "integer", minimum: 20, maximum: 500 }, rows: { type: "integer", minimum: 5, maximum: 200 } }, ["job_id", "columns", "rows"]) } },
  async execute(args, context) { return processManager(context).resize(text(args, "job_id"), optionalNumber(args, "columns")!, optionalNumber(args, "rows")!) },
}

const shellStopTool: ToolImplementation = {
  definition: { type: "function", function: { name: TOOL_NAMES.SHELL_STOP, description: "Stop a running background shell job.", parameters: toolSchema({ job_id: { type: "string" } }, ["job_id"]) } },
  async execute(args, context) { return processManager(context).stop(text(args, "job_id")) },
}

export const shellProcessTools = [shellTool, shellStartTool, shellPtyStartTool, shellStatusTool, shellSendTool, shellResizeTool, shellStopTool] satisfies ToolImplementation[]
