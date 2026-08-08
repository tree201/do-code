import { createInterface } from "node:readline"
import { randomUUID } from "node:crypto"
import type { Args } from "./cli-args.js"
import { resolveRuntimeModelConfig } from "./config.js"
import { createChatModel } from "./model.js"
import { runAgentSession } from "./session.js"
import { DO_CODE_VERSION } from "./version.js"

type Request = { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> }

export async function runAcpServer(args: Args) {
  const sessions = new Map<string, { cwd: string; controller?: AbortController }>()
  const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`)
  const respond = (request: Request, result?: unknown, error?: string) => send({ jsonrpc: "2.0", id: request.id, ...(error ? { error: { code: -32000, message: error } } : { result }) })
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    let request: Request
    try { request = JSON.parse(line) as Request } catch { continue }
    try {
      if (request.method === "initialize") {
        respond(request, { protocolVersion: 1, agentInfo: { name: "do-code", version: DO_CODE_VERSION }, agentCapabilities: { loadSession: false, promptCapabilities: { image: false, audio: false, embeddedContext: true } } })
      } else if (request.method === "session/new") {
        const sessionId = `acp_${randomUUID().slice(0, 12)}`
        const cwd = typeof request.params?.cwd === "string" ? request.params.cwd : args.workspace
        sessions.set(sessionId, { cwd })
        respond(request, { sessionId })
      } else if (request.method === "session/cancel") {
        const session = sessions.get(String(request.params?.sessionId ?? ""))
        session?.controller?.abort()
        respond(request, {})
      } else if (request.method === "session/prompt") {
        const sessionId = String(request.params?.sessionId ?? "")
        const session = sessions.get(sessionId)
        if (!session) throw new Error(`Unknown ACP session: ${sessionId}`)
        const prompt = Array.isArray(request.params?.prompt)
          ? request.params.prompt.map((part) => typeof part === "object" && part && "text" in part ? String(part.text) : "").join("\n")
          : String(request.params?.prompt ?? "")
        const model = await resolveRuntimeModelConfig(session.cwd, args.model, args.provider)
        const controller = new AbortController()
        session.controller = controller
        const result = await runAgentSession(prompt, {
          workspace: session.cwd, model: createChatModel(model), approvalMode: "auto", approveShell: async () => false, approveTool: async () => false, signal: controller.signal,
          onEvent: (event) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: event } }),
        })
        delete session.controller
        respond(request, { stopReason: result.status === "completed" ? "end_turn" : "refusal", output: result.finalAnswer, error: result.errorMessage })
      } else if (request.id !== undefined) respond(request, undefined, `Method not found: ${request.method}`)
    } catch (error) {
      if (request.id !== undefined) respond(request, undefined, error instanceof Error ? error.message : String(error))
    }
  }
}
