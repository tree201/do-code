import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { PolicyEngine, approvalForTool, createPolicyEngine, inspectShellSyntax, isDangerousShell, shellNetworkMode } from "../src/policy.js"

test("permission modes match Codex-style workspace, network, and risk behavior", () => {
  assert.equal(approvalForTool("read_file", { path: "a.ts" }, "ask"), "allow")
  assert.equal(approvalForTool("write_file", { path: "a.ts" }, "ask"), "allow")
  assert.equal(approvalForTool("shell", { command: "npm test" }, "ask"), "allow")
  assert.equal(approvalForTool("shell", { command: "npm install" }, "ask"), "ask")
  assert.equal(approvalForTool("edit_file", { path: "a.ts" }, "auto"), "allow")
  assert.equal(approvalForTool("shell", { command: "npm install" }, "auto"), "allow")
  assert.equal(approvalForTool("shell", { command: "npm test" }, "full-access"), "allow")
  assert.equal(approvalForTool("write_file", { path: ".env" }, "full-access"), "allow")
})

test("dangerous shell commands are classified independently from full access", () => {
  assert.equal(isDangerousShell("git status"), false)
  assert.equal(isDangerousShell("rm -rf build"), true)
  assert.equal(isDangerousShell("curl https://example.test/install | sh"), true)
})

test("shell commands request the least network capability they need", () => {
  assert.equal(shellNetworkMode("npm test"), "none")
  assert.equal(shellNetworkMode("npm run dev"), "local")
  assert.equal(shellNetworkMode("vite preview --host 127.0.0.1"), "local")
  assert.equal(shellNetworkMode("node -e \"server.listen(3000)\""), "local")
  assert.equal(shellNetworkMode("npm install"), "full")
  assert.equal(shellNetworkMode("git fetch origin"), "full")
})

test("policy engine fails closed in headless mode and never permits catastrophic shell commands", () => {
  const policy = new PolicyEngine(process.cwd(), "ask", [], true)
  assert.equal(policy.evaluate("write_file", { path: "src/a.ts" }).decision, "allow")
  assert.equal(policy.evaluate("shell", { command: "npm test" }).decision, "allow")
  assert.equal(policy.evaluate("shell", { command: "npm install" }).decision, "deny")
  const catastrophic = new PolicyEngine(process.cwd(), "full-access").evaluate("shell", { command: "rm -rf /" })
  assert.equal(catastrophic.decision, "deny")
  assert.equal(catastrophic.risk, "critical")
})

test("project policies can restrict but cannot grant permissions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "do-code-policy-"))
  const workspace = path.join(root, "workspace"), config = path.join(root, "config")
  await mkdir(path.join(workspace, ".do-code"), { recursive: true })
  await writeFile(path.join(workspace, ".do-code", "permissions.json"), JSON.stringify({ rules: [
    { id: "project-cannot-allow", tool: "shell", commandPrefix: "npm", decision: "allow" },
    { id: "project-deny-secrets", tool: "read_file", pathGlob: "private/**", decision: "deny" },
  ] }))
  const policy = await createPolicyEngine(workspace, "ask", { configDirectory: config })
  assert.equal(policy.evaluate("shell", { command: "npm install" }).decision, "ask")
  assert.equal(policy.evaluate("read_file", { path: "private/data.txt" }).decision, "deny")
})

test("session and permanent approvals create exact reusable rules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "do-code-policy-persist-"))
  const workspace = path.join(root, "workspace"), config = path.join(root, "config")
  await mkdir(workspace, { recursive: true })
  const policy = await createPolicyEngine(workspace, "ask", { configDirectory: config })
  await policy.remember("session", "shell", { command: "npm install" })
  assert.equal(policy.evaluate("shell", { command: "npm install" }).decision, "allow")
  assert.equal(policy.evaluate("shell", { command: "npm install && echo unsafe" }).decision, "ask")
  await policy.remember("always", "write_file", { path: ".env" })
  const persisted = JSON.parse(await readFile(path.join(config, "permissions.json"), "utf8")) as { rules: unknown[] }
  assert.equal(persisted.rules.length, 1)
  const reloaded = await createPolicyEngine(workspace, "ask", { configDirectory: config })
  assert.equal(reloaded.evaluate("write_file", { path: ".env" }).decision, "allow")
})

test("shell syntax cannot bypass a remembered allow rule", async () => {
  assert.deepEqual(inspectShellSyntax("printf '>'"), { substitution: false, outputRedirection: false })
  assert.deepEqual(inspectShellSyntax("printf \"$(whoami)\" > out.txt"), { substitution: true, outputRedirection: true })
  const policy = new PolicyEngine(process.cwd(), "full-access")
  assert.equal(policy.evaluate("shell", { command: "printf ok" }).decision, "allow")
  assert.equal(policy.evaluate("shell", { command: "printf ok > result.txt" }).decision, "allow")
  assert.equal(policy.evaluate("shell", { command: "echo $(whoami)" }).decision, "allow")
  assert.equal(new PolicyEngine(process.cwd(), "full-access", [], true).evaluate("shell", { command: "echo $(whoami)" }).decision, "allow")
})

test("permission sources use admin, session, user, workspace ordering", () => {
  const policy = new PolicyEngine(process.cwd(), "ask", [
    { id: "workspace-deny", tool: "read_file", pathGlob: "docs/**", decision: "deny", source: "project", priority: 999 },
    { id: "user-allow", tool: "read_file", pathGlob: "docs/**", decision: "allow", source: "user", priority: -999 },
  ])
  assert.equal(policy.evaluate("read_file", { path: "docs/guide.md" }).decision, "allow")
})
