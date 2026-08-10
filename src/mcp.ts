import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import type { McpServerConfig, StoredConfig } from "./config.js"
import type { ToolDefinition } from "./protocol.js"
import type { PolicyEngineContract } from "./policy-contracts.js"
import type { ToolContext, ToolImplementation } from "./tool-contracts.js"
import { DO_CODE_VERSION } from "./version.js"

type RpcResponse = { id?: number; result?: unknown; error?: { message?: string } }
type McpTool = { name: string; description?: string; inputSchema?: ToolDefinition["function"]["parameters"] }
type McpResource = { uri: string; name?: string; title?: string; description?: string; mimeType?: string }
type McpContent = { uri?: string; mimeType?: string; text?: string; blob?: string }

type McpClient = {
  start(): Promise<void>
  tools(): Promise<McpTool[]>
  call(name: string, args: unknown): Promise<{ isError?: boolean; content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown }>
  resources(): Promise<McpResource[]>
  readResource(uri: string): Promise<McpContent[]>
  close(): void
}

class StdioMcpClient implements McpClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private sequence = 1
  private buffer = ""
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()

  constructor(readonly name: string, private readonly config: McpServerConfig, private readonly workspace: string) {}

  async start() {
    if (this.child) return
    if (!this.config.command) throw new Error(`MCP ${this.name} stdio transport requires command`)
    this.child = spawn(this.config.command, this.config.args ?? [], { cwd: this.workspace, env: { ...process.env, ...this.config.env }, stdio: ["pipe", "pipe", "pipe"] })
    this.child.stdout.on("data", (chunk: Buffer) => this.consume(chunk.toString()))
    this.child.stderr.on("data", () => { /* stderr is diagnostic output, not protocol. */ })
    this.child.on("error", (error) => this.fail(error))
    this.child.on("close", (code) => this.fail(new Error(`MCP ${this.name} exited with code ${code}`)))
    await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "do-code", version: DO_CODE_VERSION } })
    this.notify("notifications/initialized", {})
  }

  async tools(): Promise<McpTool[]> {
    const result = await this.request("tools/list", {}) as { tools?: McpTool[] }
    return result.tools ?? []
  }

  async call(name: string, args: unknown) {
    return await this.request("tools/call", { name, arguments: args }) as { isError?: boolean; content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown }
  }

  async resources(): Promise<McpResource[]> {
    const result = await this.request("resources/list", {}) as { resources?: McpResource[] }
    return result.resources ?? []
  }

  async readResource(uri: string): Promise<McpContent[]> {
    const result = await this.request("resources/read", { uri }) as { contents?: McpContent[] }
    return result.contents ?? []
  }

  close() { this.child?.kill("SIGTERM"); this.child = null }

  private request(method: string, params: unknown) {
    const id = this.sequence++
    this.write({ jsonrpc: "2.0", id, method, params })
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP ${this.name} ${method} timed out`)) }, 30_000)
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value) }, reject: (error) => { clearTimeout(timer); reject(error) } })
    })
  }

  private notify(method: string, params: unknown) { this.write({ jsonrpc: "2.0", method, params }) }
  private write(value: unknown) { this.child?.stdin.write(`${JSON.stringify(value)}\n`) }

  private consume(chunk: string) {
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      let response: RpcResponse
      try { response = JSON.parse(line) as RpcResponse } catch { continue }
      if (response.id === undefined) continue
      const pending = this.pending.get(response.id)
      if (!pending) continue
      this.pending.delete(response.id)
      if (response.error) pending.reject(new Error(response.error.message ?? `MCP ${this.name} request failed`))
      else pending.resolve(response.result)
    }
  }

  private fail(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

function resolvedHeaders(headers: Record<string, string> = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => {
    const match = /^\{env:([^}]+)\}$/.exec(value.trim())
    return [key, match ? process.env[match[1]!] ?? "" : value]
  }))
}

function rpcFromResponse(body: string, contentType: string): RpcResponse {
  if (/text\/event-stream/i.test(contentType)) {
    const data = body.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean).at(-1)
    if (!data) throw new Error("MCP HTTP response did not contain an SSE data event")
    return JSON.parse(data) as RpcResponse
  }
  return JSON.parse(body) as RpcResponse
}

class HttpMcpClient implements McpClient {
  private sequence = 1
  private sessionId = ""
  constructor(readonly name: string, private readonly config: McpServerConfig) {}

  async start() {
    await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "do-code", version: DO_CODE_VERSION } })
    await this.notify("notifications/initialized", {})
  }

  async tools(): Promise<McpTool[]> {
    const result = await this.request("tools/list", {}) as { tools?: McpTool[] }
    return result.tools ?? []
  }

  async call(name: string, args: unknown) {
    return await this.request("tools/call", { name, arguments: args }) as { isError?: boolean; content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown }
  }

  async resources(): Promise<McpResource[]> {
    const result = await this.request("resources/list", {}) as { resources?: McpResource[] }
    return result.resources ?? []
  }

  async readResource(uri: string): Promise<McpContent[]> {
    const result = await this.request("resources/read", { uri }) as { contents?: McpContent[] }
    return result.contents ?? []
  }

  close() { /* HTTP transport has no child process. */ }

  private async notify(method: string, params: unknown) { await this.send({ jsonrpc: "2.0", method, params }, false) }
  private async request(method: string, params: unknown) {
    const id = this.sequence++
    const response = await this.send({ jsonrpc: "2.0", id, method, params }, true)
    if (response.error) throw new Error(response.error.message ?? `MCP ${this.name} ${method} failed`)
    return response.result
  }

  private async send(payload: unknown, expectsResponse: boolean): Promise<RpcResponse> {
    if (!this.config.url) throw new Error(`MCP ${this.name} HTTP transport requires url`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          ...resolvedHeaders(this.config.headers),
          ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(`MCP ${this.name} HTTP ${response.status} ${response.statusText}`)
      this.sessionId = response.headers.get("mcp-session-id") ?? this.sessionId
      if (!expectsResponse || response.status === 202) return {}
      return rpcFromResponse(await response.text(), response.headers.get("content-type") ?? "application/json")
    } finally { clearTimeout(timer) }
  }
}

export type ExternalTool = ToolImplementation

export class McpManager {
  private clients: McpClient[] = []
  readonly errors: string[] = []

  constructor(private readonly workspace: string, private readonly servers: StoredConfig["mcpServers"] = {}, private readonly policy?: PolicyEngineContract) {}

  async load(): Promise<ExternalTool[]> {
    const loads = Object.entries(this.servers ?? {}).map(async ([serverName, server]) => {
      if (server.enabled === false) return undefined
      const endpoint = server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ")
      const evaluation = this.policy?.evaluate("mcp_server", { command: endpoint })
      if (evaluation && evaluation.decision !== "allow") return { error: `${serverName}: Permission ${evaluation.decision}: ${evaluation.reason}` }
      const client: McpClient = server.url ? new HttpMcpClient(serverName, server) : new StdioMcpClient(serverName, server, this.workspace)
      try {
        await client.start()
        const [tools, resources] = await Promise.all([client.tools(), client.resources().catch(() => [])])
        const external: ExternalTool[] = []
        for (const tool of tools) {
          const safeServer = serverName.replace(/[^a-zA-Z0-9_-]/g, "_")
          const safeTool = tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
          external.push({
            definition: { type: "function", function: { name: `mcp__${safeServer}__${safeTool}`, description: tool.description ?? `MCP tool ${serverName}/${tool.name}`, parameters: tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: true } } },
            execute: async (args) => {
              const result = await client.call(tool.name, args)
              const output = result.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n") || (result.structuredContent ? JSON.stringify(result.structuredContent) : "(no output)")
              return { ok: result.isError !== true, output }
            },
          })
        }
        if (resources.length) {
          const safeServer = serverName.replace(/[^a-zA-Z0-9_-]/g, "_")
          external.push({
            definition: { type: "function", function: { name: `mcp__${safeServer}__list_resources`, description: `List resources exposed by MCP server ${serverName}`, parameters: { type: "object", properties: {}, additionalProperties: false } } },
            execute: async () => ({ ok: true, output: JSON.stringify(await client.resources(), null, 2) }),
          })
          external.push({
            definition: { type: "function", function: { name: `mcp__${safeServer}__read_resource`, description: `Read a resource exposed by MCP server ${serverName}`, parameters: { type: "object", properties: { uri: { type: "string" } }, required: ["uri"], additionalProperties: false } } },
            execute: async (args) => {
              const uri = typeof args === "object" && args !== null && typeof (args as Record<string, unknown>).uri === "string" ? String((args as Record<string, unknown>).uri) : ""
              if (!uri) return { ok: false, output: "uri is required" }
              const contents = await client.readResource(uri)
              return { ok: true, output: contents.map((content) => content.text ?? (content.blob ? `[base64 ${content.blob.length} characters; ${content.mimeType ?? "binary"}]` : JSON.stringify(content))).join("\n\n") || "(empty resource)" }
            },
          })
        }
        return { client, external }
      } catch (error) {
        client.close()
        return { error: `${serverName}: ${error instanceof Error ? error.message : String(error)}` }
      }
    })
    const results = await Promise.all(loads)
    const external: ExternalTool[] = []
    for (const result of results) {
      if (!result) continue
      if (result.error) this.errors.push(result.error)
      if (result.client) this.clients.push(result.client)
      if (result.external) external.push(...result.external)
    }
    return external
  }

  close() { for (const client of this.clients) client.close(); this.clients = [] }
}
