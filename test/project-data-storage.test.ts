import assert from "node:assert/strict"
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { CheckpointManager } from "../src/checkpoints.js"
import { projectConfigPath } from "../src/config.js"
import { loadPromptExtensions } from "../src/extension-registry.js"
import { createPolicyEngine } from "../src/policy.js"
import { prepareProjectData, projectDataPath, projectDataRoot } from "../src/sessions.js"

test("project data uses a user-managed path keyed by the normalized workspace", async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "do-code-project-data-"))
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-workspace-"))
  const previous = process.env.DO_CODE_DATA_DIR
  process.env.DO_CODE_DATA_DIR = data
  try {
    assert.equal(projectDataRoot(workspace), projectDataRoot(`${workspace}/.`))
    assert.equal(projectDataRoot(workspace).startsWith(workspace), false)
    await prepareProjectData(workspace)
    assert.equal(JSON.parse(await readFile(projectDataPath(workspace, "project.json"), "utf8")).workspace, workspace)
    await assert.rejects(access(path.join(workspace, ".do-code")))
  } finally {
    if (previous === undefined) delete process.env.DO_CODE_DATA_DIR
    else process.env.DO_CODE_DATA_DIR = previous
  }
})

test("legacy project data migrates without overwriting existing user data", async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "do-code-project-migrate-data-"))
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-project-migrate-workspace-"))
  const legacy = path.join(workspace, ".do-code")
  const previous = process.env.DO_CODE_DATA_DIR
  process.env.DO_CODE_DATA_DIR = data
  try {
    await mkdir(path.join(legacy, "checkpoints", "current"), { recursive: true })
    await writeFile(path.join(legacy, "config.json"), JSON.stringify({ version: 2, defaultModel: "legacy/model" }))
    await writeFile(path.join(legacy, "permissions.json"), JSON.stringify({ rules: [{ id: "deny-private", tool: "read_file", pathGlob: "private/**", decision: "deny" }] }))
    await writeFile(path.join(legacy, "checkpoints", "current", "cp_legacy.json"), "{}")

    await prepareProjectData(workspace)

    assert.equal(JSON.parse(await readFile(projectConfigPath(workspace), "utf8")).defaultModel, "legacy/model")
    await access(projectDataPath(workspace, "permissions.json"))
    await access(projectDataPath(workspace, "checkpoints", "current", "cp_legacy.json"))
    await assert.rejects(access(legacy))
  } finally {
    if (previous === undefined) delete process.env.DO_CODE_DATA_DIR
    else process.env.DO_CODE_DATA_DIR = previous
  }
})

test("checkpoints, project policies, and extensions stay outside the workspace", async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "do-code-project-scoped-data-"))
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-project-scoped-workspace-"))
  const configDirectory = path.join(data, "config")
  const previous = process.env.DO_CODE_DATA_DIR
  process.env.DO_CODE_DATA_DIR = data
  try {
    await writeFile(path.join(workspace, "existing.txt"), "before\n")
    const checkpoints = new CheckpointManager(workspace, "test")
    const checkpoint = await checkpoints.create("edit_file", "existing.txt")
    assert.equal(checkpoints.directory.startsWith(workspace), false)
    await writeFile(path.join(workspace, "existing.txt"), "after\n")
    await checkpoints.restore(checkpoint.id)
    assert.equal(await readFile(path.join(workspace, "existing.txt"), "utf8"), "before\n")

    await mkdir(projectDataPath(workspace, "commands"), { recursive: true })
    await writeFile(path.join(projectDataPath(workspace, "commands"), "review.md"), "Review $ARGUMENTS")
    await writeFile(projectDataPath(workspace, "permissions.json"), JSON.stringify({ rules: [{ id: "deny-private", tool: "read_file", pathGlob: "private/**", decision: "deny" }] }))
    const extensions = await loadPromptExtensions(workspace)
    const policy = await createPolicyEngine(workspace, "ask", { configDirectory })
    assert.equal(extensions.find((entry) => entry.name === "review")?.source, "project")
    assert.equal(policy.evaluate("read_file", { path: "private/value.txt" }).decision, "deny")
    await assert.rejects(access(path.join(workspace, ".do-code")))
  } finally {
    if (previous === undefined) delete process.env.DO_CODE_DATA_DIR
    else process.env.DO_CODE_DATA_DIR = previous
  }
})
