import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { PolicyEngine } from "../src/policy.js"
import { executeTool, resolveInside, toolDefinitions } from "../src/tools.js"

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
