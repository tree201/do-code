import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { projectConfigPath } from "../src/config-paths.js"
import { modelProvidersPublic } from "../src/config-catalog.js"
import { loadStoredConfig, mergeConfig, saveDefaultModel, saveDefaultReasoningEffort, saveDefaultThinkingMode, saveMigratedConfig } from "../src/config-storage.js"

test("configuration layers merge provider models without replacing provider settings", () => {
  const merged = mergeConfig(
    {
      version: 2,
      defaultModel: "proxy/base",
      providers: { proxy: { baseUrl: "https://proxy.example/v1", apiKeyEnv: "PROXY_KEY", models: { base: { modelId: "base-v1" } } } },
    },
    {
      version: 2,
      defaultModel: "proxy/project",
      providers: { proxy: { models: { project: { modelId: "project-v2" } } } },
    },
  )

  assert.equal(merged.defaultModel, "proxy/project")
  assert.equal(merged.providers?.proxy?.baseUrl, "https://proxy.example/v1")
  assert.equal(merged.providers?.proxy?.apiKeyEnv, "PROXY_KEY")
  assert.deepEqual(merged.providers?.proxy?.models, {
    base: { modelId: "base-v1" },
    project: { modelId: "project-v2" },
  })
})

test("loading and migrated persistence retain ordered sources without storing metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "do-code-config-storage-"))
  const system = path.join(root, "system.json")
  const user = path.join(root, "user.json")
  const workspace = path.join(root, "workspace")
  const project = path.join(workspace, ".do-code", "config.json")
  await mkdir(path.dirname(project), { recursive: true })
  await writeFile(system, JSON.stringify({ version: 2, language: "en", defaultModel: "system/model" }))
  await writeFile(user, JSON.stringify({ version: 2, language: "zh" }))
  await writeFile(project, JSON.stringify({ version: 2, defaultModel: "project/model" }))

  const previousUser = process.env.DO_CODE_CONFIG_PATH
  const previousSystem = process.env.DO_CODE_SYSTEM_CONFIG_PATH
  const previousData = process.env.DO_CODE_DATA_DIR
  process.env.DO_CODE_CONFIG_PATH = user
  process.env.DO_CODE_SYSTEM_CONFIG_PATH = system
  process.env.DO_CODE_DATA_DIR = path.join(root, "data")
  try {
    const loaded = await loadStoredConfig(workspace)
    assert.equal(loaded.language, "zh")
    assert.equal(loaded.defaultModel, "project/model")
    assert.deepEqual(loaded.sources, [system, user, projectConfigPath(workspace)])

    assert.equal(await saveMigratedConfig(workspace), user)
    const persisted = JSON.parse(await readFile(user, "utf8")) as Record<string, unknown>
    assert.equal(persisted.language, "zh")
    assert.equal(persisted.defaultModel, "project/model")
    assert.equal("sources" in persisted, false)
  } finally {
    if (previousUser === undefined) delete process.env.DO_CODE_CONFIG_PATH
    else process.env.DO_CODE_CONFIG_PATH = previousUser
    if (previousSystem === undefined) delete process.env.DO_CODE_SYSTEM_CONFIG_PATH
    else process.env.DO_CODE_SYSTEM_CONFIG_PATH = previousSystem
    if (previousData === undefined) delete process.env.DO_CODE_DATA_DIR
    else process.env.DO_CODE_DATA_DIR = previousData
  }
})

test("saving a default model updates only the user config layer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "do-code-default-model-"))
  const user = path.join(root, "user.json")
  await writeFile(user, JSON.stringify({ version: 2, language: "zh", defaultModel: "old/model" }))
  const previousUser = process.env.DO_CODE_CONFIG_PATH
  process.env.DO_CODE_CONFIG_PATH = user
  try {
    assert.equal(await saveDefaultModel("new/model"), user)
    const persisted = JSON.parse(await readFile(user, "utf8")) as Record<string, unknown>
    assert.equal(persisted.defaultModel, "new/model")
    assert.equal(persisted.language, "zh")
  } finally {
    if (previousUser === undefined) delete process.env.DO_CODE_CONFIG_PATH
    else process.env.DO_CODE_CONFIG_PATH = previousUser
  }
})

test("saving reasoning defaults updates only the user config layer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "do-code-reasoning-defaults-"))
  const user = path.join(root, "user.json")
  await writeFile(user, JSON.stringify({ version: 2, defaultModel: "ark/model", language: "zh" }))
  const previousUser = process.env.DO_CODE_CONFIG_PATH
  process.env.DO_CODE_CONFIG_PATH = user
  try {
    await saveDefaultReasoningEffort("high")
    await saveDefaultThinkingMode("on")
    const persisted = JSON.parse(await readFile(user, "utf8")) as Record<string, unknown>
    assert.equal(persisted.defaultReasoningEffort, "high")
    assert.equal(persisted.defaultThinkingMode, "on")
    assert.equal(persisted.defaultModel, "ark/model")
    assert.equal(persisted.language, "zh")
  } finally {
    if (previousUser === undefined) delete process.env.DO_CODE_CONFIG_PATH
    else process.env.DO_CODE_CONFIG_PATH = previousUser
  }
})

test("public provider catalog reports credential availability without exposing values", () => {
  const catalog = modelProvidersPublic({
    version: 2,
    env: { LOCAL_KEY: "stored-secret" },
    providerProtocol: { proxy: "anthropic" },
    modelProviders: { proxy: [{ id: "model-a", envKey: "LOCAL_KEY" }] },
  })

  assert.deepEqual(catalog, [{
    id: "proxy",
    protocol: "anthropic",
    models: [{ id: "model-a", envKey: "LOCAL_KEY", credentialAvailable: true }],
  }])
  assert.doesNotMatch(JSON.stringify(catalog), /stored-secret/)
})
