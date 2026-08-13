import type { ToolDefinition, ToolPresentation } from "./protocol.js"
import type {
  ApprovalChoice,
  ApprovalMode,
  PolicyEngineContract,
  PolicyEvaluation,
  SandboxNetworkMode,
  ToolApprovalRequest,
} from "./policy-contracts.js"

export type ToolResult = { ok: boolean; output: string; presentation?: ToolPresentation }
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled" | "blocked"
export type TodoItem = { id: string; content: string; status: TodoStatus }

export type PlanProposal = {
  title: string
  summary: string
  steps: Array<string | { id: string; description: string; status: TodoStatus }>
  files?: string[]
  verification?: string[]
  risks?: string[]
}

export type ShellSpawnSpec = { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }

export type BackgroundProcessController = {
  start(command: string, spec: ShellSpawnSpec): { id: string; pid: number | undefined }
  startPty(command: string, spec: ShellSpawnSpec, columns?: number, rows?: number): Promise<{ id: string; pid: number; mode: "pty"; columns: number; rows: number }>
  status(id?: string, lines?: number, delayMs?: number): Promise<ToolResult>
  stop(id: string): ToolResult
  send(id: string, input: string, submit?: boolean): ToolResult
  resize(id: string, columns: number, rows: number): ToolResult
  close(): void
}

export type ToolContext = {
  workspace: string
  signal?: AbortSignal
  approveShell: (command: string) => Promise<ApprovalChoice | boolean>
  runShell?: (command: string, timeoutMs: number, onOutput?: (chunk: string) => void, signal?: AbortSignal, network?: SandboxNetworkMode) => Promise<ToolResult>
  shellSpawnSpec?: (command: string, network?: SandboxNetworkMode) => ShellSpawnSpec
  onToolOutput?: (chunk: string) => void
  onPathAccess?: (requestedPath: string) => Promise<void> | void
  approvalMode?: ApprovalMode
  approveTool?: (request: ToolApprovalRequest) => Promise<ApprovalChoice | boolean>
  policy?: PolicyEngineContract
  onPolicyDecision?: (tool: string, evaluation: PolicyEvaluation) => void
  askUser?: (question: string, options: string[]) => Promise<string>
  processManager?: BackgroundProcessController
  getTodos?: () => TodoItem[]
  setTodos?: (items: TodoItem[]) => void
  beforeFileWrite?: (tool: string, requestedPath: string) => Promise<void>
  delegateTask?: (task: string, signal?: AbortSignal) => Promise<string>
  enterPlanMode?: (reason: string) => Promise<ApprovalMode>
  publishPlan?: (plan: PlanProposal) => void
  isPlanMode?: () => boolean
  /** Set only for a single policy-approved call that may cross the workspace boundary. */
  allowOutsideWorkspace?: boolean
}

export type ToolImplementation = {
  definition: ToolDefinition
  execute(args: unknown, context: ToolContext): Promise<ToolResult>
}
