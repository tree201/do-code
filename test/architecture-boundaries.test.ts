import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import test from "node:test"

const run = promisify(execFile)

test("architecture checks accept the current migration baseline", async () => {
  await run(process.execPath, ["scripts/check-architecture.js"])
})

test("architecture check scripts are exposed through package scripts", async () => {
  const packageJson = await import("../package.json", { with: { type: "json" } })
  assert.equal(typeof packageJson.default.scripts["check:architecture"], "string")
})
