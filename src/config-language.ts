import type { DoCodeLanguage } from "./config-contracts.js"
import { doCodeConfigPath } from "./config-paths.js"
import { localeDefinition, normalizeLocale } from "./locale-registry.js"
import { migrateConfig } from "./config-schema.js"
import { readConfigJson, writeStoredConfig } from "./config-storage.js"

export function normalizeLanguage(value: string): DoCodeLanguage | null {
  return normalizeLocale(value)
}

export function outputLanguageInstruction(language: DoCodeLanguage) {
  return localeDefinition(language).outputInstruction
}

export async function saveLanguagePreference(language: DoCodeLanguage) {
  const file = doCodeConfigPath()
  const existing = migrateConfig(await readConfigJson(file), file)
  await writeStoredConfig(file, { ...existing, language })
  return file
}
