import assert from "node:assert/strict"
import test from "node:test"
import { optionalBoolean, optionalNumber, optionalText, resolveToolPath, text, truncateToolOutput } from "../src/tool-input.js"

test("tool input helpers validate required and optional fields", () => {
  assert.equal(text({ path: "src/main.ts" }, "path"), "src/main.ts")
  assert.equal(optionalNumber({ limit: 10 }, "limit"), 10)
  assert.equal(optionalText({ glob: "*.ts" }, "glob"), "*.ts")
  assert.equal(optionalBoolean({ fixed: true }, "fixed"), true)
  assert.throws(() => text({ path: 1 }, "path"), /Expected string field: path/)
  assert.throws(() => optionalNumber({ limit: -1 }, "limit"), /Expected non-negative integer: limit/)
  assert.throws(() => optionalBoolean({ fixed: "yes" }, "fixed"), /Expected boolean field: fixed/)
})

test("tool path resolution stays inside the workspace unless explicitly allowed", () => {
  const context = { workspace: "/tmp/workspace" }
  assert.equal(resolveToolPath(context, "src/main.ts"), "/tmp/workspace/src/main.ts")
  assert.throws(() => resolveToolPath(context, "../secret"), /Path escapes workspace/)
  assert.equal(resolveToolPath({ ...context, allowOutsideWorkspace: true }, "../secret"), "/tmp/secret")
})

test("tool output truncation keeps both beginning and end", () => {
  const output = truncateToolOutput("a".repeat(50_000))
  assert.match(output, /output truncated/)
  assert.ok(output.startsWith("a"))
  assert.ok(output.endsWith("a"))
})
