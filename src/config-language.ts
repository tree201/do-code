import type { DoCodeLanguage } from "./config-contracts.js"
import { doCodeConfigPath } from "./config-paths.js"
import { migrateConfig } from "./config-schema.js"
import { readConfigJson, writeStoredConfig } from "./config-storage.js"

export function normalizeLanguage(value: string): DoCodeLanguage | null {
  const normalized = value.trim().toLowerCase()
  if (["en", "en-us", "english", "英文"].includes(normalized)) return "en"
  if (["zh", "zh-cn", "chinese", "中文", "简体中文"].includes(normalized)) return "zh"
  return null
}

export function outputLanguageInstruction(language: DoCodeLanguage) {
  return language === "zh"
    ? "Respond to the user in Simplified Chinese. Keep code, identifiers, commands, file paths, and exact error messages unchanged when appropriate."
    : "Respond to the user in English. Keep code, identifiers, commands, file paths, and exact error messages unchanged when appropriate."
}

export async function saveLanguagePreference(language: DoCodeLanguage) {
  const file = doCodeConfigPath()
  const existing = migrateConfig(await readConfigJson(file), file)
  await writeStoredConfig(file, { ...existing, language })
  return file
}
