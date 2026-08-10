import assert from "node:assert/strict"
import test from "node:test"
import type { SandboxNetworkMode } from "../src/config.js"
import { captureCommand, defaultShellSpawnSpec, runShellCommand } from "../src/tool-shell.js"
import { BoundedOutput } from "../src/bounded-output.js"

test("bounded output retains stable head and tail without growing past its limit", () => {
  const output = new BoundedOutput(20)
  output.append("0123456789")
  output.append("abcdefghij")
  output.append("KLMNOPQRST")
  assert.match(output.value(), /^0123456789/)
  assert.match(output.value(), /KLMNOPQRST$/)
  assert.match(output.value(), /10 characters omitted/)
})

test("shell command runner streams output and preserves exit status", async () => {
  const chunks: string[] = []
  const result = await runShellCommand(process.env.SHELL ?? "/bin/sh", ["-lc", "printf out; printf err >&2; exit 3"], process.cwd(), 10_000, [0], (chunk) => chunks.push(chunk))
  assert.equal(result.ok, false)
  assert.match(result.output, /out\nerr|err\nout/)
  assert.deepEqual(chunks, ["out", "err"])
})

test("capture command returns stdout, stderr, and code independently", async () => {
  const result = await captureCommand(process.env.SHELL ?? "/bin/sh", ["-lc", "printf out; printf err >&2; exit 2"], process.cwd())
  assert.equal(result.code, 2)
  assert.equal(result.stdout, "out")
  assert.equal(result.stderr, "err")
  assert.equal(result.error, undefined)
})

test("capture command can stop a process after a bounded amount of output", async () => {
  const result = await captureCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(100000))"], process.cwd(), 10_000, 1_000)
  assert.equal(result.truncated, true)
  assert.ok(result.stdout.length < 1_200)
})

test("default shell spawn spec delegates network policy when provided", () => {
  assert.deepEqual(defaultShellSpawnSpec({ workspace: "/tmp/workspace" }, "ls"), { executable: process.env.SHELL ?? "/bin/sh", args: ["-c", "ls"], cwd: "/tmp/workspace", env: process.env })
  assert.deepEqual(defaultShellSpawnSpec({ workspace: "/tmp/workspace", shellSpawnSpec: (command: string, network?: SandboxNetworkMode) => ({ executable: "custom", args: [command], cwd: "/tmp", env: {}, network }) } as never, "ls", "full"), { executable: "custom", args: ["ls"], cwd: "/tmp", env: {}, network: "full" })
})
