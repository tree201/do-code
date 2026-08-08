import { spawn } from "node:child_process"
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises"
import { isIP } from "node:net"
import path from "node:path"
import type { JsonSchema, ToolDefinition, ToolPresentation } from "./protocol.js"
import { createToolPresentation, lineCount, replacementDiffLines } from "./tool-presentation.js"
import { approved, approvalForTool, approvalRequest, planModeRestriction, shellNetworkMode, type ApprovalChoice, type ApprovalMode, type PolicyEngine, type PolicyEvaluation, type ToolApprovalRequest } from "./policy.js"
import { BackgroundProcessManager, type ShellSpawnSpec } from "./background-processes.js"
import type { SandboxNetworkMode } from "./config.js"

const MAX_OUTPUT = 40_000
const MAX_FILE_BYTES = 200_000
const MAX_BATCH_FILES = 20
const DEFAULT_RESULT_LIMIT = 200
const DEFAULT_EXCLUDES = ["!.git/**", "!.do-code/**", "!**/node_modules/**", "!**/dist/**", "!**/build/**", "!**/coverage/**"]
const MAX_WEB_BYTES = 1_000_000
const MAX_WEB_REDIRECTS = 5

export type ToolResult = { ok: boolean; output: string; presentation?: ToolPresentation }
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled" | "blocked"
export type TodoItem = { id: string; content: string; status: TodoStatus }
export type PlanProposal = {
  title: string
  summary: string
  steps: string[]
  files: string[]
  verification: string[]
  risks: string[]
}
export type PlanReviewDecision = "execute" | "revise" | "cancel"

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
  policy?: PolicyEngine
  onPolicyDecision?: (tool: string, evaluation: PolicyEvaluation) => void
  askUser?: (question: string, options: string[]) => Promise<string>
  processManager?: BackgroundProcessManager
  getTodos?: () => TodoItem[]
  setTodos?: (items: TodoItem[]) => void
  beforeFileWrite?: (tool: string, requestedPath: string) => Promise<void>
  delegateTask?: (task: string) => Promise<string>
  enterPlanMode?: (reason: string) => Promise<ApprovalMode>
  reviewPlan?: (plan: PlanProposal) => Promise<PlanReviewDecision>
  isPlanMode?: () => boolean
  /** Set only for a single policy-approved call that may cross the workspace boundary. */
  allowOutsideWorkspace?: boolean
}

type Tool = {
  definition: ToolDefinition
  execute(args: unknown, context: ToolContext): Promise<ToolResult>
}

function schema(properties: Record<string, unknown>, required: string[]): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false }
}

function text(value: unknown, field: string) {
  if (typeof value !== "object" || value === null || typeof (value as Record<string, unknown>)[field] !== "string") {
    throw new Error(`Expected string field: ${field}`)
  }
  return (value as Record<string, string>)[field]!
}

function optionalNumber(value: unknown, field: string) {
  if (typeof value !== "object" || value === null) return undefined
  const item = (value as Record<string, unknown>)[field]
  if (item === undefined) return undefined
  if (typeof item !== "number" || !Number.isInteger(item) || item < 0) throw new Error(`Expected non-negative integer: ${field}`)
  return item
}

function optionalText(value: unknown, field: string) {
  if (typeof value !== "object" || value === null) return undefined
  const item = (value as Record<string, unknown>)[field]
  if (item === undefined) return undefined
  if (typeof item !== "string") throw new Error(`Expected string field: ${field}`)
  return item
}

function optionalBoolean(value: unknown, field: string) {
  if (typeof value !== "object" || value === null) return undefined
  const item = (value as Record<string, unknown>)[field]
  if (item === undefined) return undefined
  if (typeof item !== "boolean") throw new Error(`Expected boolean field: ${field}`)
  return item
}

function stringArray(value: unknown, field: string) {
  if (typeof value !== "object" || value === null) throw new Error(`Expected string array field: ${field}`)
  const item = (value as Record<string, unknown>)[field]
  if (!Array.isArray(item) || item.some((entry) => typeof entry !== "string")) {
    throw new Error(`Expected string array field: ${field}`)
  }
  return item as string[]
}

function optionalStringArray(value: unknown, field: string) {
  if (typeof value !== "object" || value === null || (value as Record<string, unknown>)[field] === undefined) return []
  return stringArray(value, field)
}

export function resolveInside(workspace: string, requested: string) {
  const root = path.resolve(workspace)
  const target = path.resolve(root, requested)
  const relative = path.relative(root, target)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${requested}`)
  }
  return target
}

function pathIsOutsideWorkspace(workspace: string, requested: string) {
  const root = path.resolve(workspace)
  const target = path.resolve(root, requested)
  const relative = path.relative(root, target)
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

function resolveToolPath(context: ToolContext, requested: string) {
  if (context.allowOutsideWorkspace || context.policy?.mode === "full-access" || context.approvalMode === "full-access") {
    return path.resolve(context.workspace, requested)
  }
  return resolveInside(context.workspace, requested)
}

export async function assertRealPathInside(workspace: string, requested: string) {
  const lexical = resolveInside(workspace, requested)
  const root = await realpath(path.resolve(workspace))
  let probe = lexical
  while (probe !== path.dirname(probe)) {
    try { probe = await realpath(probe); break }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      probe = path.dirname(probe)
    }
  }
  const relative = path.relative(root, probe)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Path escapes workspace through a symbolic link: ${requested}`)
  return lexical
}

function truncate(output: string) {
  if (output.length <= MAX_OUTPUT) return output
  const half = Math.floor((MAX_OUTPUT - 80) / 2)
  return `${output.slice(0, half)}\n\n... output truncated ...\n\n${output.slice(-half)}`
}

function decodeHtml(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

function privateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "")
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true
  const version = isIP(normalized)
  if (version === 4) {
    const [a = 0, b = 0] = normalized.split(".").map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  if (version === 6) return normalized === "::1" || normalized === "::" || /^f[cd]/i.test(normalized) || /^fe[89ab]/i.test(normalized)
  return false
}

function safeWebUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP(S) URLs are supported")
  if (url.username || url.password) throw new Error("URLs containing credentials are blocked")
  if (privateHostname(url.hostname)) throw new Error(`Private or local network host is blocked: ${url.hostname}`)
  return url
}

async function fetchWeb(urlValue: string, timeoutMs = 20_000, redirects = 0): Promise<{ url: string; contentType: string; body: string }> {
  if (redirects > MAX_WEB_REDIRECTS) throw new Error(`Too many redirects (limit ${MAX_WEB_REDIRECTS})`)
  const url = safeWebUrl(urlValue)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException("Web request timed out", "TimeoutError")), Math.min(Math.max(timeoutMs, 1_000), 60_000))
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "user-agent": "do-code/0.3 (+https://github.com/do-code)", accept: "text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1" },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) throw new Error(`Redirect ${response.status} did not include a Location header`)
      return await fetchWeb(new URL(location, url).toString(), timeoutMs, redirects + 1)
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    const length = Number(response.headers.get("content-length") ?? 0)
    if (length > MAX_WEB_BYTES) throw new Error(`Response is too large: ${length} bytes (limit ${MAX_WEB_BYTES})`)
    const reader = response.body?.getReader()
    if (!reader) return { url: response.url || url.toString(), contentType: response.headers.get("content-type") ?? "", body: "" }
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > MAX_WEB_BYTES) { await reader.cancel(); throw new Error(`Response exceeded ${MAX_WEB_BYTES} bytes`) }
      chunks.push(next.value)
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
    return { url: response.url || url.toString(), contentType: response.headers.get("content-type") ?? "", body }
  } finally {
    clearTimeout(timer)
  }
}

function searchResults(html: string, limit: number) {
  const results: Array<{ title: string; url: string; snippet: string }> = []
  const links = [...html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  for (const match of links.slice(0, limit)) {
    const rawUrl = match[1] ?? ""
    const redirected = (() => { try { return new URL(rawUrl, "https://duckduckgo.com").searchParams.get("uddg") ?? rawUrl } catch { return rawUrl } })()
    const tail = html.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 1800)
    const snippetMatch = /<(?:a|div)[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(tail)
    results.push({ title: decodeHtml(match[2] ?? ""), url: redirected, snippet: decodeHtml(snippetMatch?.[1] ?? "") })
  }
  return results
}

async function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
  okCodes: number[] = [0],
  onOutput?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<ToolResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"], ...(signal ? { signal } : {}) })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs)
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      onOutput?.(text)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      onOutput?.(text)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({ ok: false, output: error.message })
    })
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      const output = truncate([stdout, stderr].filter(Boolean).join("\n").trim())
      resolve({
        ok: code !== null && okCodes.includes(code),
        output: output || `Command exited with code ${code}${signal ? ` (${signal})` : ""}`,
      })
    })
  })
}

type CapturedCommand = { code: number | null; stdout: string; stderr: string; error?: string }

async function capture(command: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<CapturedCommand> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (result: CapturedCommand) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      finish({ code: null, stdout, stderr, error: `Command timed out after ${timeoutMs}ms` })
    }, timeoutMs)
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
    child.on("error", (error) => finish({ code: null, stdout, stderr, error: error.message }))
    child.on("close", (code) => finish({ code, stdout, stderr }))
  })
}

function rgExcludes() {
  return DEFAULT_EXCLUDES.flatMap((pattern) => ["--glob", pattern])
}

async function discoverFiles(context: ToolContext, requested: string, pattern?: string) {
  const target = resolveToolPath(context, requested)
  const info = await stat(target)
  if (!info.isDirectory()) throw new Error(`Path is not a directory: ${requested}`)
  const args = ["--files", "--hidden", ...rgExcludes()]
  try {
    const gitIgnore = path.join(context.workspace, ".gitignore")
    if ((await stat(gitIgnore)).isFile()) args.push("--ignore-file", gitIgnore)
  } catch {
    // A workspace does not need a .gitignore file.
  }
  if (pattern) args.push("--glob", pattern)
  args.push(".")
  const result = await capture("rg", args, target)
  if (result.error) throw new Error(result.error)
  if (result.code !== 0 && result.code !== 1) throw new Error(result.stderr.trim() || `ripgrep exited with code ${result.code}`)
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => entry.replace(/^\.\//, ""))
    .sort((a, b) => a.localeCompare(b))
}

function isBinary(content: Buffer) {
  return content.subarray(0, Math.min(content.length, 8_000)).includes(0)
}

function decodeText(content: Buffer, requested: string) {
  if (isBinary(content)) throw new Error(`File appears to be binary: ${requested}`)
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content)
  } catch {
    throw new Error(`File is not valid UTF-8 text: ${requested}`)
  }
}

async function readTextFile(context: ToolContext, requested: string) {
  const target = resolveToolPath(context, requested)
  const info = await stat(target)
  if (!info.isFile()) throw new Error(`Path is not a file: ${requested}`)
  if (info.size > MAX_FILE_BYTES) throw new Error(`File is too large: ${info.size} bytes (limit ${MAX_FILE_BYTES})`)
  return decodeText(await readFile(target), requested)
}

async function applyGitPatch(workspace: string, patchText: string, signal?: AbortSignal) {
  return await new Promise<ToolResult>((resolve) => {
    const child = spawn("git", ["apply", "--whitespace=nowarn", "-"], { cwd: workspace, stdio: ["pipe", "pipe", "pipe"], ...(signal ? { signal } : {}) })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.on("error", (error) => resolve({ ok: false, output: error.message }))
    child.on("close", (code) => resolve({ ok: code === 0, output: output.trim() || (code === 0 ? "Patch applied" : `git apply exited with code ${code}`) }))
    child.stdin.end(patchText)
  })
}

function patchPaths(patchText: string) {
  const paths = new Set<string>()
  for (const line of patchText.split(/\r?\n/)) {
    const match = /^(?:---|\+\+\+)\s+([^\t ]+)/.exec(line)
    if (!match || match[1] === "/dev/null") continue
    paths.add(match[1]!.replace(/^[ab]\//, ""))
  }
  return [...paths]
}

const fallbackProcessManagers = new Map<string, BackgroundProcessManager>()

function processManager(context: ToolContext) {
  if (context.processManager) return context.processManager
  const workspace = path.resolve(context.workspace)
  const current = fallbackProcessManagers.get(workspace) ?? new BackgroundProcessManager()
  fallbackProcessManagers.set(workspace, current)
  return current
}

function defaultSpawnSpec(context: ToolContext, command: string, network: SandboxNetworkMode = "none"): ShellSpawnSpec {
  return context.shellSpawnSpec?.(command, network) ?? { executable: process.env.SHELL ?? "/bin/sh", args: ["-c", command], cwd: context.workspace, env: process.env }
}

const tools: Tool[] = [
  {
    definition: {
      type: "function",
      function: {
        name: "web_fetch",
        description: "Fetch a public HTTP(S) page and return readable text. Local/private network targets and oversized responses are blocked.",
        parameters: schema({ url: { type: "string", description: "Public HTTP(S) URL" }, timeout_ms: { type: "integer", minimum: 1000, maximum: 60000 } }, ["url"]),
      },
    },
    async execute(args) {
      const fetched = await fetchWeb(text(args, "url"), optionalNumber(args, "timeout_ms") ?? 20_000)
      const readable = /html/i.test(fetched.contentType) ? decodeHtml(fetched.body) : fetched.body.trim()
      return { ok: true, output: truncate(`URL: ${fetched.url}\nContent-Type: ${fetched.contentType || "unknown"}\n\n${readable || "(empty response)"}`) }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the public web for current technical documentation and error information. Returns titles, URLs, and snippets.",
        parameters: schema({ query: { type: "string" }, max_results: { type: "integer", minimum: 1, maximum: 10 } }, ["query"]),
      },
    },
    async execute(args) {
      const query = text(args, "query").trim()
      if (!query) return { ok: false, output: "Search query must not be empty" }
      const limit = Math.min(Math.max(optionalNumber(args, "max_results") ?? 5, 1), 10)
      const fetched = await fetchWeb(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`)
      const results = searchResults(fetched.body, limit)
      return { ok: true, output: results.length ? results.map((result, index) => `${index + 1}. ${result.title}\n${result.url}${result.snippet ? `\n${result.snippet}` : ""}`).join("\n\n") : "No search results found" }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "delegate_task",
        description: "Delegate a bounded, read-only research or review task to a child coding agent and return its findings.",
        parameters: schema({ task: { type: "string", description: "A concrete, self-contained subtask" } }, ["task"]),
      },
    },
    async execute(args, context) {
      if (!context.delegateTask) return { ok: false, output: "Subagents are disabled in configuration" }
      return { ok: true, output: await context.delegateTask(text(args, "task")) }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "list_directory",
        description: "List the immediate files and directories in a workspace directory. Respects project ignores.",
        parameters: schema(
          {
            path: { type: "string", description: "Workspace-relative directory; use . for the root" },
            limit: { type: "integer", minimum: 1, maximum: 1000 },
          },
          ["path"],
        ),
      },
    },
    async execute(args, context) {
      const requested = text(args, "path")
      const limit = Math.min(optionalNumber(args, "limit") ?? DEFAULT_RESULT_LIMIT, 1000)
      const files = await discoverFiles(context, requested)
      const entries = new Set<string>()
      for (const file of files) {
        const [head, ...rest] = file.split("/")
        if (head) entries.add(rest.length > 0 ? `${head}/` : head)
      }
      const sorted = [...entries].sort((a, b) => a.localeCompare(b))
      const suffix = sorted.length > limit ? `\n... ${sorted.length - limit} more entries` : ""
      return { ok: true, output: sorted.slice(0, limit).join("\n") + suffix || "(empty directory)" }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "glob",
        description: "Find workspace files matching a glob pattern. Respects .gitignore and default generated-directory exclusions.",
        parameters: schema(
          {
            pattern: { type: "string", description: "Glob such as **/*.ts" },
            path: { type: "string", description: "Workspace-relative directory; defaults to ." },
            limit: { type: "integer", minimum: 1, maximum: 1000 },
          },
          ["pattern"],
        ),
      },
    },
    async execute(args, context) {
      const requested = optionalText(args, "path") ?? "."
      const limit = Math.min(optionalNumber(args, "limit") ?? DEFAULT_RESULT_LIMIT, 1000)
      const files = await discoverFiles(context, requested, text(args, "pattern"))
      const prefixed = files.map((file) => requested === "." ? file : path.join(requested, file))
      const suffix = prefixed.length > limit ? `\n... ${prefixed.length - limit} more files` : ""
      return { ok: true, output: prefixed.slice(0, limit).join("\n") + suffix || "(no files)" }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a UTF-8 text file with optional zero-based line offset and line limit.",
        parameters: schema(
          {
            path: { type: "string" },
            offset: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 1 },
          },
          ["path"],
        ),
      },
    },
    async execute(args, context) {
      const requested = text(args, "path")
      const lines = (await readTextFile(context, requested)).split(/\r?\n/)
      const offset = optionalNumber(args, "offset") ?? 0
      const limit = optionalNumber(args, "limit") ?? 400
      const selected = lines.slice(offset, offset + limit).map((line, index) => `${offset + index + 1}: ${line}`)
      return { ok: true, output: truncate(selected.join("\n")) }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "read_many_files",
        description: "Read and concatenate up to 20 UTF-8 workspace files selected by exact paths or glob patterns.",
        parameters: schema(
          {
            include: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_BATCH_FILES },
            exclude: { type: "array", items: { type: "string" } },
          },
          ["include"],
        ),
      },
    },
    async execute(args, context) {
      const include = stringArray(args, "include")
      if (include.length === 0) return { ok: false, output: "include must not be empty" }
      if (include.length > MAX_BATCH_FILES) return { ok: false, output: `Too many include patterns (limit ${MAX_BATCH_FILES})` }
      const exclude = typeof args === "object" && args !== null && (args as Record<string, unknown>).exclude !== undefined
        ? stringArray(args, "exclude")
        : []
      const selected = new Set<string>()
      for (const item of include) {
        resolveToolPath(context, item)
        try {
          const info = await stat(resolveToolPath(context, item))
          if (info.isFile()) selected.add(item)
          else if (info.isDirectory()) {
            for (const file of await discoverFiles(context, item)) selected.add(path.join(item, file))
          }
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code !== "ENOENT" && !/[?*\[]/.test(item)) throw error
          for (const file of await discoverFiles(context, ".", item)) selected.add(file)
        }
      }
      let files = [...selected].sort((a, b) => a.localeCompare(b))
      if (exclude.length > 0) {
        const excluded = new Set<string>()
        for (const pattern of exclude) {
          for (const file of await discoverFiles(context, ".", pattern)) excluded.add(file)
        }
        files = files.filter((file) => !excluded.has(file))
      }
      const overflow = files.length - MAX_BATCH_FILES
      files = files.slice(0, MAX_BATCH_FILES)
      const sections: string[] = []
      const skipped: string[] = []
      for (const file of files) {
        try {
          sections.push(`--- ${file} ---\n${await readTextFile(context, file)}`)
        } catch (error) {
          skipped.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (overflow > 0) skipped.push(`${overflow} additional matching file(s): batch limit reached`)
      if (skipped.length > 0) sections.push(`--- skipped ---\n${skipped.join("\n")}`)
      return { ok: true, output: truncate(sections.join("\n\n") || "(no readable files)") }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "search",
        description: "Search text in workspace files using ripgrep.",
        parameters: schema(
          {
            query: { type: "string" },
            path: { type: "string", description: "Workspace-relative file or directory" },
            glob: { type: "string", description: "Optional file glob such as *.ts" },
            context: { type: "integer", minimum: 0, maximum: 20 },
            max_results: { type: "integer", minimum: 1, maximum: 1000 },
            fixed_strings: { type: "boolean", description: "Treat query literally instead of as a regular expression" },
          },
          ["query", "path"],
        ),
      },
    },
    async execute(args, context) {
      const query = text(args, "query")
      const requested = text(args, "path")
      const target = resolveToolPath(context, requested)
      const searchArgs = ["-n", "--color", "never", "--no-heading", "--hidden", ...rgExcludes()]
      try {
        const gitIgnore = path.join(context.workspace, ".gitignore")
        if ((await stat(gitIgnore)).isFile()) searchArgs.push("--ignore-file", gitIgnore)
      } catch {
        // A workspace does not need a .gitignore file.
      }
      if (optionalBoolean(args, "fixed_strings")) searchArgs.push("-F")
      const surrounding = Math.min(optionalNumber(args, "context") ?? 0, 20)
      if (surrounding > 0) searchArgs.push("-C", String(surrounding))
      const fileGlob = optionalText(args, "glob")
      if (fileGlob) searchArgs.push("--glob", fileGlob)
      searchArgs.push("--", query, target)
      const result = await capture("rg", searchArgs, context.workspace)
      if (result.error) return { ok: false, output: result.error }
      if (result.code === 1) return { ok: true, output: "(no matches)" }
      if (result.code !== 0) return { ok: false, output: result.stderr.trim() || `ripgrep exited with code ${result.code}` }
      const lines = result.stdout.trimEnd().split(/\r?\n/)
      const limit = Math.min(optionalNumber(args, "max_results") ?? DEFAULT_RESULT_LIMIT, 1000)
      const suffix = lines.length > limit ? `\n... ${lines.length - limit} more result lines` : ""
      return { ok: true, output: truncate(lines.slice(0, limit).join("\n") + suffix) }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "write_file",
        description: "Create or completely replace a UTF-8 file inside the workspace.",
        parameters: schema({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
      },
    },
    async execute(args, context) {
      const requested = text(args, "path")
      const target = resolveToolPath(context, requested)
      const content = text(args, "content")
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content, "utf8")
      return {
        ok: true,
        output: `Wrote ${requested}`,
        presentation: {
          kind: "edit",
          targets: [requested],
          fileChanges: [{
            path: requested,
            additions: lineCount(content),
            deletions: 0,
            lines: lineCount(content),
            diffLines: replacementDiffLines("", content, 1),
          }],
        },
      }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "edit_file",
        description: "Replace one exact, unique text block in a UTF-8 file.",
        parameters: schema(
          { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } },
          ["path", "old_text", "new_text"],
        ),
      },
    },
    async execute(args, context) {
      const requested = text(args, "path")
      const target = resolveToolPath(context, requested)
      const oldText = text(args, "old_text")
      if (!oldText) return { ok: false, output: "old_text must not be empty" }
      const content = await readTextFile(context, requested)
      const first = content.indexOf(oldText)
      if (first < 0) return { ok: false, output: "old_text was not found" }
      if (content.indexOf(oldText, first + oldText.length) >= 0) return { ok: false, output: "old_text is not unique" }
      const newText = text(args, "new_text")
      const startLine = content.slice(0, first).split(/\r?\n/).length
      await writeFile(target, content.slice(0, first) + newText + content.slice(first + oldText.length), "utf8")
      return {
        ok: true,
        output: `Edited ${requested}`,
        presentation: {
          kind: "edit",
          targets: [requested],
          fileChanges: [{
            path: requested,
            additions: lineCount(newText),
            deletions: lineCount(oldText),
            diffLines: replacementDiffLines(oldText, newText, startLine),
          }],
        },
      }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "enter_plan_mode",
        description: "Enter a safe read-only planning phase for an ambiguous, cross-cutting, architectural, or high-risk task. Do not use this for small, obvious changes.",
        parameters: schema({ reason: { type: "string" } }, ["reason"]),
      },
    },
    async execute(args, context) {
      if (!context.enterPlanMode) return { ok: false, output: "Interactive plan mode is unavailable in this run" }
      const previousMode = await context.enterPlanMode(text(args, "reason"))
      return { ok: true, output: `Entered read-only plan mode. Approval mode remains ${previousMode}. Research the repository, resolve material choices with ask_user, then submit a concrete plan with exit_plan_mode.` }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "exit_plan_mode",
        description: "Submit the finalized implementation plan for user review. This interaction asks whether to execute, revise, or cancel; do not separately ask whether the plan is approved.",
        parameters: schema({
          title: { type: "string" },
          summary: { type: "string" },
          steps: { type: "array", minItems: 1, items: { type: "string" } },
          files: { type: "array", items: { type: "string" } },
          verification: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
        }, ["title", "summary", "steps"]),
      },
    },
    async execute(args, context) {
      if (!context.reviewPlan) return { ok: false, output: "Interactive plan review is unavailable in this run" }
      const proposal: PlanProposal = {
        title: text(args, "title"),
        summary: text(args, "summary"),
        steps: stringArray(args, "steps"),
        files: optionalStringArray(args, "files"),
        verification: optionalStringArray(args, "verification"),
        risks: optionalStringArray(args, "risks"),
      }
      const decision = await context.reviewPlan(proposal)
      if (decision === "execute") return { ok: true, output: "The user approved the plan. Exit planning and implement it now using the approval mode that was already active; do not change permissions." }
      if (decision === "revise") return { ok: true, output: "The user requested changes to the plan. Stay in read-only plan mode, stop this turn, and invite the user to provide feedback before submitting another plan." }
      return { ok: true, output: "The user cancelled this plan. Stop without making changes." }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "ask_user",
        description: "Ask 1-4 blocking, structured clarification questions when a material choice cannot be inferred safely.",
        parameters: schema({ questions: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", properties: {
          id: { type: "string" }, header: { type: "string", maxLength: 12 }, question: { type: "string" },
          options: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label", "description"], additionalProperties: false } },
        }, required: ["id", "header", "question"], additionalProperties: false } } }, ["questions"]),
      },
    },
    async execute(args, context) {
      if (!context.askUser) return { ok: false, output: "User input is unavailable in this run" }
      const record = args as Record<string, unknown>
      const rawQuestions = Array.isArray(record.questions) ? record.questions.slice(0, 4) : []
      if (!rawQuestions.length) return { ok: false, output: "questions must contain 1-4 items" }
      const answers: Record<string, string> = {}
      for (const [index, rawQuestion] of rawQuestions.entries()) {
        if (!rawQuestion || typeof rawQuestion !== "object") return { ok: false, output: `Question ${index + 1} is invalid` }
        const question = rawQuestion as Record<string, unknown>
        if (typeof question.id !== "string" || typeof question.header !== "string" || typeof question.question !== "string") return { ok: false, output: `Question ${index + 1} requires id, header, and question` }
        if (question.header.length > 12) return { ok: false, output: `Question header must be 12 characters or fewer: ${question.header}` }
        const rawOptions = Array.isArray(question.options) ? question.options : []
        if (rawOptions.length && (rawOptions.length < 2 || rawOptions.length > 4)) return { ok: false, output: `Question ${question.id} requires 2-4 options` }
        const options = rawOptions.map((rawOption) => {
          if (!rawOption || typeof rawOption !== "object") throw new Error(`Invalid option in question ${question.id}`)
          const option = rawOption as Record<string, unknown>
          if (typeof option.label !== "string" || typeof option.description !== "string") throw new Error(`Options require label and description in question ${question.id}`)
          return `${option.label} — ${option.description}`
        })
        if (options.length) options.push("Other — Enter a different answer")
        const selected = await context.askUser(`[${question.header}] ${question.question}`, options)
        const matching = rawOptions.find((rawOption) => typeof rawOption === "object" && rawOption !== null && selected.startsWith(`${String((rawOption as Record<string, unknown>).label)} —`)) as Record<string, unknown> | undefined
        answers[question.id] = matching ? String(matching.label) : selected.startsWith("Other —") ? "Other" : selected
      }
      return { ok: true, output: JSON.stringify({ answers }, null, 2) }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "todo_write",
        description: "Replace the current task plan. Keep exactly one item in_progress while work remains.",
        parameters: schema({
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, content: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled", "blocked"] } },
              required: ["id", "content", "status"],
              additionalProperties: false,
            },
          },
        }, ["items"]),
      },
    },
    async execute(args, context) {
      const raw = (args as Record<string, unknown>).items
      if (!Array.isArray(raw)) return { ok: false, output: "items must be an array" }
      const items = raw.map((item) => item as Record<string, unknown>)
      if (items.some((item) => typeof item.id !== "string" || typeof item.content !== "string" || !["pending", "in_progress", "completed", "cancelled", "blocked"].includes(String(item.status)))) return { ok: false, output: "Each todo requires id, content, and a valid status" }
      if (items.filter((item) => item.status === "in_progress").length > 1) return { ok: false, output: "At most one todo may be in_progress" }
      const normalized = items.map((item) => ({ id: String(item.id), content: String(item.content), status: item.status as TodoStatus }))
      context.setTodos?.(normalized)
      return { ok: true, output: normalized.length ? normalized.map((item) => `${item.status === "completed" ? "✓" : item.status === "in_progress" ? "→" : item.status === "blocked" ? "!" : item.status === "cancelled" ? "×" : "○"} ${item.id}: ${item.content}`).join("\n") : "Task plan cleared" }
    },
  },
  {
    definition: {
      type: "function",
      function: { name: "todo_read", description: "Read the current structured task plan.", parameters: schema({}, []) },
    },
    async execute(_args, context) {
      const items = context.getTodos?.() ?? []
      return { ok: true, output: items.length ? JSON.stringify(items, null, 2) : "No task plan" }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "apply_patch",
        description: "Apply one unified Git patch that may update multiple files inside the workspace.",
        parameters: schema({ patch: { type: "string" } }, ["patch"]),
      },
    },
    async execute(args, context) {
      const patchText = text(args, "patch")
      const paths = patchPaths(patchText)
      if (!paths.length) return { ok: false, output: "Patch does not contain file headers" }
      for (const requested of paths) {
        await assertRealPathInside(context.workspace, requested)
        await context.beforeFileWrite?.("apply_patch", requested)
      }
      return await applyGitPatch(context.workspace, patchText, context.signal)
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "shell",
        description: "Run a shell command in the workspace. Use this for tests, builds, and repository inspection.",
        parameters: schema(
          { command: { type: "string" }, timeout_ms: { type: "integer", minimum: 1000, maximum: 600000 } },
          ["command"],
        ),
      },
    },
    async execute(args, context) {
      const command = text(args, "command")
      const timeout = optionalNumber(args, "timeout_ms") ?? 120_000
      if (!context.policy && !context.approvalMode && !approved(await context.approveShell(command))) return { ok: false, output: "Shell command was declined by the user" }
      if (context.runShell) return await context.runShell(command, Math.min(timeout, 600_000), context.onToolOutput, context.signal, shellNetworkMode(command))
      return await run(process.env.SHELL ?? "/bin/sh", ["-lc", command], context.workspace, Math.min(timeout, 600_000), [0], context.onToolOutput, context.signal)
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "shell_start",
        description: "Start a long-running shell command in the background and return a job ID.",
        parameters: schema({ command: { type: "string" } }, ["command"]),
      },
    },
    async execute(args, context) {
      const command = text(args, "command")
      const started = processManager(context).start(command, defaultSpawnSpec(context, command, shellNetworkMode(command)))
      return { ok: true, output: JSON.stringify(started) }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "shell_pty_start",
        description: "Start an interactive terminal command in a real PTY. Use for REPLs, debuggers, terminal UIs, password prompts, and commands that require terminal capabilities.",
        parameters: schema({ command: { type: "string" }, columns: { type: "integer", minimum: 20, maximum: 500 }, rows: { type: "integer", minimum: 5, maximum: 200 } }, ["command"]),
      },
    },
    async execute(args, context) {
      const command = text(args, "command")
      const started = await processManager(context).startPty(command, defaultSpawnSpec(context, command, shellNetworkMode(command)), optionalNumber(args, "columns") ?? 120, optionalNumber(args, "rows") ?? 30)
      return { ok: true, output: JSON.stringify(started) }
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "shell_status",
        description: "Read background shell job status and recent output.",
        parameters: schema({ job_id: { type: "string" }, lines: { type: "integer", minimum: 1, maximum: 1000 }, delay_ms: { type: "integer", minimum: 0, maximum: 5000 } }, []),
      },
    },
    async execute(args, context) { return await processManager(context).status(optionalText(args, "job_id"), optionalNumber(args, "lines") ?? 100, optionalNumber(args, "delay_ms") ?? 0) },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "shell_send",
        description: "Send text or a response to a running background shell or PTY job.",
        parameters: schema({ job_id: { type: "string" }, input: { type: "string" }, submit: { type: "boolean" } }, ["job_id", "input"]),
      },
    },
    async execute(args, context) { return processManager(context).send(text(args, "job_id"), text(args, "input"), optionalBoolean(args, "submit") ?? true) },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "shell_resize",
        description: "Resize a running PTY job.",
        parameters: schema({ job_id: { type: "string" }, columns: { type: "integer", minimum: 20, maximum: 500 }, rows: { type: "integer", minimum: 5, maximum: 200 } }, ["job_id", "columns", "rows"]),
      },
    },
    async execute(args, context) { return processManager(context).resize(text(args, "job_id"), optionalNumber(args, "columns")!, optionalNumber(args, "rows")!) },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "shell_stop",
        description: "Stop a running background shell job.",
        parameters: schema({ job_id: { type: "string" } }, ["job_id"]),
      },
    },
    async execute(args, context) { return processManager(context).stop(text(args, "job_id")) },
  },
]

const byName = new Map(tools.map((tool) => [tool.definition.function.name, tool]))

export const toolDefinitions = tools.map((tool) => tool.definition)

export async function executeTool(name: string, args: unknown, context: ToolContext): Promise<ToolResult> {
  const tool = byName.get(name)
  if (!tool) return { ok: false, output: `Unknown tool: ${name}` }
  try {
    const record = typeof args === "object" && args !== null ? args as Record<string, unknown> : {}
    const requestedPaths = [
      ...(typeof record.path === "string" ? [record.path] : []),
      ...(Array.isArray(record.include) ? record.include.filter((item): item is string => typeof item === "string" && !/[?*\[]/.test(item)) : []),
    ]
    let outsideWorkspace = requestedPaths.some((requested) => pathIsOutsideWorkspace(context.workspace, requested))
    if (!outsideWorkspace) {
      for (const requested of requestedPaths) {
        try { await assertRealPathInside(context.workspace, requested) }
        catch (error) {
          if (error instanceof Error && /Path escapes workspace/.test(error.message)) { outsideWorkspace = true; break }
          throw error
        }
      }
    }
    const policyRecord = outsideWorkspace ? { ...record, __outsideWorkspace: true } : record
    const evaluation = (context.isPlanMode?.() ? planModeRestriction(name) : null)
      ?? context.policy?.evaluate(name, policyRecord)
      ?? (context.approvalMode ? { decision: approvalForTool(name, policyRecord, context.approvalMode), risk: "medium" as const, reason: `${context.approvalMode} approval mode` } : null)
    let allowOutsideWorkspace = context.policy?.mode === "full-access" || context.approvalMode === "full-access"
    if (evaluation) {
      context.onPolicyDecision?.(name, evaluation)
      if (evaluation.decision === "deny") return { ok: false, output: `Permission denied: ${evaluation.reason}` }
      if (evaluation.decision === "ask") {
        const request = approvalRequest(name, record, evaluation)
        const choice = context.approveTool
          ? await context.approveTool(request)
          : name === "shell" || name === "shell_start"
            ? await context.approveShell(String(record.command ?? ""))
            : undefined
        if (!approved(choice)) return { ok: false, output: `${name} was not approved` }
        if (typeof choice === "string") await context.policy?.remember(choice, name, record)
        if (outsideWorkspace) allowOutsideWorkspace = true
      }
    }
    if (!allowOutsideWorkspace) {
      for (const requested of requestedPaths) await assertRealPathInside(context.workspace, requested)
    }
    const callContext = allowOutsideWorkspace ? { ...context, allowOutsideWorkspace: true } : context
    if ((name === "write_file" || name === "edit_file") && typeof record.path === "string") {
      await context.beforeFileWrite?.(name, record.path)
    }
    if (context.onPathAccess && typeof args === "object" && args !== null) {
      const values = args as Record<string, unknown>
      const paths = [
        ...(typeof values.path === "string" ? [values.path] : []),
        ...(Array.isArray(values.include) ? values.include.filter((item): item is string => typeof item === "string") : []),
      ]
      for (const requestedPath of new Set(paths)) await context.onPathAccess(requestedPath)
    }
    const startedAt = Date.now()
    const result = await tool.execute(args, callContext)
    return { ...result, presentation: result.presentation ?? createToolPresentation(name, args, result, Date.now() - startedAt) }
  } catch (error) {
    if (context.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error
    return { ok: false, output: error instanceof Error ? error.message : String(error) }
  }
}
