import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { executeTool, resolveInside, toolDefinitions } from "../src/tools.js"
import type { SandboxNetworkMode } from "../src/config.js"
import { PolicyEngine } from "../src/policy.js"

test("exposes only the current file discovery tools", () => {
  const names = toolDefinitions.map((definition) => definition.function.name)
  assert.ok(names.includes("list_directory"))
  assert.ok(names.includes("glob"))
  assert.ok(!names.includes("list_files"))
  assert.ok(names.includes("web_fetch"))
  assert.ok(names.includes("web_search"))
})

test("web tools return readable public content and block private network targets", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-web-"))
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes("duckduckgo")) return new Response('<a class="result__a" href="https://example.com/docs">Example docs</a><div class="result__snippet">Useful <b>API</b> reference</div>', { status: 200, headers: { "content-type": "text/html" } })
    return new Response("<main><h1>Title</h1><p>Hello &amp; welcome.</p></main>", { status: 200, headers: { "content-type": "text/html" } })
  }
  try {
    const context = { workspace, approveShell: async () => false, approvalMode: "full-access" as const }
    const fetched = await executeTool("web_fetch", { url: "https://example.com/docs" }, context)
    assert.equal(fetched.ok, true)
    assert.match(fetched.output, /Title\nHello & welcome/)
    const searched = await executeTool("web_search", { query: "example api" }, context)
    assert.equal(searched.ok, true)
    assert.match(searched.output, /Example docs[\s\S]*example\.com\/docs[\s\S]*Useful API reference/)
    const blocked = await executeTool("web_fetch", { url: "http://127.0.0.1/private" }, context)
    assert.equal(blocked.ok, false)
    assert.match(blocked.output, /Private or local network host is blocked/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("resolveInside rejects paths outside the workspace", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-path-"))
  assert.throws(() => resolveInside(workspace, "../outside"), /escapes workspace/)
})

test("resolveInside supports the filesystem root without false escape errors", () => {
  assert.equal(resolveInside("/", "testbed/file.py"), path.resolve("/testbed/file.py"))
})

test("outside-workspace files require approval unless Full Access is active", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "do-code-permissions-"))
  const workspace = path.join(root, "workspace")
  const outside = path.join(root, "outside.txt")
  await mkdir(workspace)

  const denied = await executeTool("write_file", { path: outside, content: "denied" }, {
    workspace,
    policy: new PolicyEngine(workspace, "ask"),
    approveShell: async () => false,
    approveTool: async () => false,
  })
  assert.equal(denied.ok, false)

  const approved = await executeTool("write_file", { path: outside, content: "approved" }, {
    workspace,
    policy: new PolicyEngine(workspace, "ask"),
    approveShell: async () => false,
    approveTool: async () => "once",
  })
  assert.equal(approved.ok, true)
  assert.equal(await readFile(outside, "utf8"), "approved")

  await symlink(root, path.join(workspace, "linked-root"), "dir")
  const approvedSymlinkRead = await executeTool("read_file", { path: "linked-root/outside.txt" }, {
    workspace,
    policy: new PolicyEngine(workspace, "ask"),
    approveShell: async () => false,
    approveTool: async () => "once",
  })
  assert.equal(approvedSymlinkRead.ok, true)
  assert.match(approvedSymlinkRead.output, /approved/)

  const fullAccess = await executeTool("write_file", { path: outside, content: "full" }, {
    workspace,
    policy: new PolicyEngine(workspace, "full-access"),
    approveShell: async () => false,
    approveTool: async () => false,
  })
  assert.equal(fullAccess.ok, true)
  assert.equal(await readFile(outside, "utf8"), "full")
})

test("edit_file requires a unique exact match", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-edit-"))
  await writeFile(path.join(workspace, "a.txt"), "one\ntwo\n", "utf8")
  const context = { workspace, approveShell: async () => false }
  const result = await executeTool(
    "edit_file",
    { path: "a.txt", old_text: "two", new_text: "three" },
    context,
  )
  assert.equal(result.ok, true)
  assert.equal(await readFile(path.join(workspace, "a.txt"), "utf8"), "one\nthree\n")
})

test("shell streams stdout and stderr while preserving the final output", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-shell-stream-"))
  const chunks: string[] = []
  const result = await executeTool(
    "shell",
    { command: "printf 'first\\n'; printf 'second\\n' >&2" },
    { workspace, approveShell: async () => true, onToolOutput: (chunk) => chunks.push(chunk) },
  )

  assert.equal(result.ok, true)
  assert.match(chunks.join(""), /first/)
  assert.match(chunks.join(""), /second/)
  assert.match(result.output, /first/)
  assert.match(result.output, /second/)
})

test("list_directory and glob respect project and generated-directory ignores", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-discovery-"))
  await mkdir(path.join(workspace, "src"), { recursive: true })
  await mkdir(path.join(workspace, "node_modules", "pkg"), { recursive: true })
  await mkdir(path.join(workspace, ".do-code"), { recursive: true })
  await writeFile(path.join(workspace, ".gitignore"), "ignored.txt\n", "utf8")
  await writeFile(path.join(workspace, "src", "main.ts"), "export {}\n", "utf8")
  await writeFile(path.join(workspace, "src", "note.md"), "note\n", "utf8")
  await writeFile(path.join(workspace, "ignored.txt"), "ignored\n", "utf8")
  await writeFile(path.join(workspace, "node_modules", "pkg", "index.js"), "ignored\n", "utf8")
  await writeFile(path.join(workspace, ".do-code", "secret.txt"), "secret\n", "utf8")
  const context = { workspace, approveShell: async () => false }

  const listed = await executeTool("list_directory", { path: "." }, context)
  assert.equal(listed.ok, true)
  assert.match(listed.output, /src\//)
  assert.doesNotMatch(listed.output, /node_modules|\.do-code|ignored\.txt/)

  const globbed = await executeTool("glob", { pattern: "**/*.ts" }, context)
  assert.equal(globbed.ok, true)
  assert.equal(globbed.output, "src/main.ts")
})

test("read_many_files accepts globs and reports binary files without leaking content", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-read-many-"))
  await mkdir(path.join(workspace, "src"), { recursive: true })
  await writeFile(path.join(workspace, "src", "a.ts"), "const a = 1\n", "utf8")
  await writeFile(path.join(workspace, "src", "b.ts"), "const b = 2\n", "utf8")
  await writeFile(path.join(workspace, "src", "image.bin"), Buffer.from([1, 0, 2, 3]))
  const context = { workspace, approveShell: async () => false }

  const textFiles = await executeTool("read_many_files", { include: ["src/*.ts"] }, context)
  assert.equal(textFiles.ok, true)
  assert.match(textFiles.output, /--- src\/a\.ts ---/)
  assert.match(textFiles.output, /--- src\/b\.ts ---/)

  const binary = await executeTool("read_many_files", { include: ["src/image.bin"] }, context)
  assert.equal(binary.ok, true)
  assert.match(binary.output, /appears to be binary/)
})

test("read_file rejects binary data and normalizes CRLF line display", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-read-"))
  await writeFile(path.join(workspace, "windows.txt"), "one\r\ntwo\r\n", "utf8")
  await writeFile(path.join(workspace, "binary.dat"), Buffer.from([65, 0, 66]))
  const context = { workspace, approveShell: async () => false }

  const textResult = await executeTool("read_file", { path: "windows.txt" }, context)
  assert.equal(textResult.ok, true)
  assert.equal(textResult.output, "1: one\n2: two\n3: ")
  const binaryResult = await executeTool("read_file", { path: "binary.dat" }, context)
  assert.equal(binaryResult.ok, false)
  assert.match(binaryResult.output, /binary/)
})

test("search supports file globs, literal queries, context, and result limits", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-search-"))
  await writeFile(path.join(workspace, "a.ts"), "before\na+b\na+b\nafter\n", "utf8")
  await writeFile(path.join(workspace, "b.md"), "a+b\n", "utf8")
  const result = await executeTool(
    "search",
    { query: "a+b", path: ".", glob: "*.ts", fixed_strings: true, context: 1, max_results: 3 },
    { workspace, approveShell: async () => false },
  )

  assert.equal(result.ok, true)
  assert.match(result.output, /a\.ts/)
  assert.doesNotMatch(result.output, /b\.md/)
  assert.match(result.output, /more result lines/)
})

test("real path checks reject symbolic-link workspace escapes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "do-code-symlink-"))
  const workspace = path.join(root, "workspace"), outside = path.join(root, "outside")
  await mkdir(workspace); await mkdir(outside)
  await writeFile(path.join(outside, "secret.txt"), "secret")
  await symlink(outside, path.join(workspace, "linked"))
  const result = await executeTool("read_file", { path: "linked/secret.txt" }, { workspace, approveShell: async () => false })
  assert.equal(result.ok, false)
  assert.match(result.output, /symbolic link/)
})

test("apply_patch updates multiple workspace files through one tool call", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-apply-patch-"))
  await writeFile(path.join(workspace, "a.txt"), "old\n")
  await writeFile(path.join(workspace, "b.txt"), "before\n")
  const patch = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-before\n+after\n"
  const result = await executeTool("apply_patch", { patch }, { workspace, approveShell: async () => false })
  assert.equal(result.ok, true, result.output)
  assert.equal(await readFile(path.join(workspace, "a.txt"), "utf8"), "new\n")
  assert.equal(await readFile(path.join(workspace, "b.txt"), "utf8"), "after\n")
})

test("ask_user and todo tools expose structured interaction state", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-interaction-tools-"))
  let todos: Array<{ id: string; content: string; status: "pending" | "in_progress" | "completed" | "cancelled" | "blocked" }> = []
  const context = { workspace, approveShell: async () => false, askUser: async () => "Option B", getTodos: () => todos, setTodos: (items: typeof todos) => { todos = items } }
  const question = await executeTool("ask_user", { questions: [{ id: "choice", header: "Choice", question: "Choose", options: [{ label: "Option A", description: "First" }, { label: "Option B", description: "Second" }] }] }, context)
  assert.match(question.output, /Option B/)
  const written = await executeTool("todo_write", { items: [{ id: "1", content: "Implement", status: "in_progress" }] }, context)
  assert.equal(written.ok, true)
  const read = await executeTool("todo_read", {}, context)
  assert.match(read.output, /Implement/)
})

test("plan tools enter read-only planning and return the user's execution decision", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-plan-tools-"))
  let enteredReason = ""
  let reviewedTitle = ""
  const context = {
    workspace,
    approveShell: async () => false,
    enterPlanMode: async (reason: string) => { enteredReason = reason; return "auto" as const },
    reviewPlan: async (plan: { title: string }) => { reviewedTitle = plan.title; return "execute" as const },
  }
  const entered = await executeTool("enter_plan_mode", { reason: "Cross-cutting refactor" }, context)
  assert.equal(entered.ok, true)
  assert.equal(enteredReason, "Cross-cutting refactor")
  assert.match(entered.output, /Approval mode remains auto/)

  const reviewed = await executeTool("exit_plan_mode", {
    title: "Refactor authentication",
    summary: "Separate policy from transport.",
    steps: ["Extract policy", "Update callers"],
    files: ["src/auth.ts"],
    verification: ["npm test"],
    risks: ["Session compatibility"],
  }, context)
  assert.equal(reviewed.ok, true)
  assert.equal(reviewedTitle, "Refactor authentication")
  assert.match(reviewed.output, /approval mode that was already active/i)
})

test("plan interaction blocks mutations without changing the execution approval mode", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-plan-policy-"))
  const context = {
    workspace,
    approveShell: async () => false,
    approvalMode: "full-access" as const,
    isPlanMode: () => true,
  }
  const blocked = await executeTool("write_file", { path: "blocked.txt", content: "no" }, context)
  assert.equal(blocked.ok, false)
  assert.match(blocked.output, /Plan mode blocks write_file/)

  const readable = await executeTool("list_directory", { path: "." }, context)
  assert.equal(readable.ok, true)
  assert.equal(context.approvalMode, "full-access")
})

test("shell tool forwards the command's least required network mode", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-shell-network-"))
  const requested: SandboxNetworkMode[] = []
  const context = {
    workspace,
    approveShell: async () => true,
    runShell: async (_command: string, _timeoutMs: number, _onOutput?: (chunk: string) => void, _signal?: AbortSignal, network: SandboxNetworkMode = "none") => {
      requested.push(network)
      return { ok: true, output: "ok" }
    },
  }
  await executeTool("shell", { command: "npm test" }, context)
  await executeTool("shell", { command: "npm run dev" }, context)
  await executeTool("shell", { command: "npm install" }, context)
  assert.deepEqual(requested, ["none", "local", "full"])
})

test("background shell tools start, inspect, and stop jobs", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-background-"))
  const context = { workspace, approveShell: async () => true }
  const started = await executeTool("shell_start", { command: "printf ready; sleep 5" }, context)
  assert.equal(started.ok, true)
  const id = (JSON.parse(started.output) as { id: string }).id
  await new Promise((resolve) => setTimeout(resolve, 40))
  const status = await executeTool("shell_status", { job_id: id }, context)
  assert.match(status.output, /ready/)
  const stopped = await executeTool("shell_stop", { job_id: id }, context)
  assert.equal(stopped.ok, true)
})

test("background shell jobs accept session-scoped input", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-bg-input-"))
  const context = { workspace, approveShell: async () => true }
  const started = await executeTool("shell_start", { command: "read value; printf 'received:%s' \"$value\"" }, context)
  const id = JSON.parse(started.output).id as string
  assert.equal((await executeTool("shell_send", { job_id: id, input: "hello" }, context)).ok, true)
  const status = await executeTool("shell_status", { job_id: id, delay_ms: 50 }, context)
  assert.match(status.output, /received:hello/)
})

test("PTY shell jobs support terminal input, status, resize, and stop", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-pty-input-"))
  const context = { workspace, approveShell: async () => true, approvalMode: "full-access" as const }
  const started = await executeTool("shell_pty_start", { command: "read value; printf 'pty:%s\\n' \"$value\"; sleep 5", columns: 80, rows: 20 }, context)
  assert.equal(started.ok, true, started.output)
  const id = (JSON.parse(started.output) as { id: string }).id
  assert.match(id, /^pty_/)
  assert.equal((await executeTool("shell_resize", { job_id: id, columns: 100, rows: 25 }, context)).ok, true)
  assert.equal((await executeTool("shell_send", { job_id: id, input: "hello" }, context)).ok, true)
  const status = await executeTool("shell_status", { job_id: id, delay_ms: 80 }, context)
  assert.match(status.output, /"mode": "pty"/)
  assert.match(status.output, /pty:hello/)
  assert.equal((await executeTool("shell_stop", { job_id: id }, context)).ok, true)
})
