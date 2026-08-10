import assert from "node:assert/strict"
import test from "node:test"
import path from "node:path"
import { doCodeConfigPath, effectiveReasoningEffort, effectiveThinkingMode, migrateConfig, normalizeLanguage, normalizeReasoningEffort, normalizeThinkingMode, outputLanguageInstruction, projectConfigPath, systemConfigPath } from "../src/config.js"

test("configuration paths honor explicit environment overrides", () => {
  const previous = {
    doCode: process.env.DO_CODE_CONFIG_PATH,
    system: process.env.DO_CODE_SYSTEM_CONFIG_PATH,
  }
  process.env.DO_CODE_CONFIG_PATH = "/tmp/do-code.json"
  process.env.DO_CODE_SYSTEM_CONFIG_PATH = "/tmp/system.json"
  try {
    assert.equal(doCodeConfigPath(), "/tmp/do-code.json")
    assert.equal(systemConfigPath(), "/tmp/system.json")
  } finally {
    for (const [key, value] of Object.entries({
      DO_CODE_CONFIG_PATH: previous.doCode,
      DO_CODE_SYSTEM_CONFIG_PATH: previous.system,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("project configuration path is rooted at the resolved workspace", () => {
  assert.equal(projectConfigPath("./workspace"), path.join(path.resolve("./workspace"), ".do-code", "config.json"))
})

test("language normalization accepts supported aliases and emits stable instructions", () => {
  assert.equal(normalizeLanguage("English"), "en")
  assert.equal(normalizeLanguage("简体中文"), "zh")
  assert.equal(normalizeLanguage("fr"), null)
  assert.match(outputLanguageInstruction("en"), /Respond to the user in English/)
  assert.match(outputLanguageInstruction("zh"), /Respond to the user in Simplified Chinese/)
})

test("model preference normalization selects supported fallback levels", () => {
  assert.equal(normalizeReasoningEffort(" XHIGH "), "xhigh")
  assert.equal(normalizeReasoningEffort("invalid"), null)
  assert.equal(effectiveReasoningEffort("high", ["low", "max"]), "low")
  assert.equal(normalizeThinkingMode(" ON "), "on")
  assert.equal(normalizeThinkingMode("invalid"), null)
  assert.equal(effectiveThinkingMode("on", ["auto", "off"]), "auto")
})

test("provider migration normalizes model entries and ignores removed credential metadata", () => {
  const config = migrateConfig({
    version: 2,
    providers: { proxy: { baseUrl: "https://example.com/v1", apiKeyEnv: "PROXY_KEY", models: { chat: { modelId: "chat-v2", contextWindow: 4096 } } } },
    modelProviders: { modern: [{ id: "vision", baseUrl: "https://modern.example/v1", envKey: "MODERN_KEY", supportedEfforts: ["low", "high"], supportsImages: true }] },
  })
  assert.deepEqual(config.providers?.proxy?.models?.chat, { modelId: "chat-v2", contextWindow: 4096 })
  assert.deepEqual(config.modelProviders?.modern?.[0], { id: "vision", baseUrl: "https://modern.example/v1", envKey: "MODERN_KEY", supportedEfforts: ["low", "high"], supportsImages: true })
  assert.throws(() => migrateConfig({ providers: { proxy: { baseUrl: "not-a-url" } } }), /baseUrl must be an HTTP\(S\) URL/)
  assert.deepEqual(migrateConfig({ modelProviders: { modern: [{ id: "vision", credential: { source: "unknown" } }] } }).modelProviders?.modern, [{ id: "vision" }])
})
