import assert from "node:assert/strict"
import test from "node:test"
import path from "node:path"
import { doCodeConfigPath, effectiveReasoningEffort, effectiveThinkingMode, localeDefinitions, migrateConfig, normalizeLanguage, normalizeReasoningEffort, normalizeThinkingMode, outputLanguageInstruction, projectConfigPath, supportedLanguages, systemConfigPath } from "../src/config.js"
import { availableLanguagesText, languageDisplay, t } from "../src/ui/i18n.js"

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

test("locale registry drives aliases, configuration validation, and model instructions", () => {
  assert.deepEqual(supportedLanguages(), localeDefinitions.map((locale) => locale.id))
  assert.equal(normalizeLanguage("English"), "en")
  assert.equal(normalizeLanguage("简体中文"), "zh")
  assert.equal(normalizeLanguage("日本語"), "ja")
  assert.equal(normalizeLanguage("한국어"), "ko")
  assert.equal(normalizeLanguage("español"), "es")
  assert.equal(normalizeLanguage("français"), "fr")
  assert.equal(normalizeLanguage("de"), null)
  for (const locale of localeDefinitions) {
    assert.equal(migrateConfig({ language: locale.id }).language, locale.id)
    assert.ok(locale.nativeName)
    assert.ok(locale.englishName)
    assert.ok(locale.bcp47)
    assert.equal(outputLanguageInstruction(locale.id), locale.outputInstruction)
  }
  assert.throws(() => migrateConfig({ language: "de" }), /language must be one of: en, zh, ja, ko, es, fr/)
  assert.equal(languageDisplay("ja", "en"), "Japanese [ja-JP]")
  assert.equal(languageDisplay("ja", "zh"), "日本語 [ja-JP]")
  assert.match(availableLanguagesText("en"), /Japanese \[ja-JP\].*Korean \[ko-KR\].*Spanish \[es-ES\].*French \[fr-FR\]/)
  assert.equal(t("ja", "Current language"), "現在の言語")
  assert.equal(t("ko", "Current language"), "현재 언어")
  assert.equal(t("es", "Current language"), "Idioma actual")
  assert.equal(t("fr", "Current language"), "Langue actuelle")
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
