import type { DoCodeLanguage } from "./config-contracts.js"

export type LocaleDefinition = {
  id: DoCodeLanguage
  aliases: string[]
  nativeName: string
  englishName: string
  bcp47: string
  outputInstruction: string
}

export const localeDefinitions: readonly LocaleDefinition[] = [
  {
    id: "en",
    aliases: ["en", "en-us", "english", "英文"],
    nativeName: "English",
    englishName: "English",
    bcp47: "en-US",
    outputInstruction: "Respond to the user in English. Keep code, identifiers, commands, file paths, and exact error messages unchanged when appropriate.",
  },
  {
    id: "zh",
    aliases: ["zh", "zh-cn", "chinese", "中文", "简体中文"],
    nativeName: "中文",
    englishName: "Chinese",
    bcp47: "zh-CN",
    outputInstruction: "Respond to the user in Simplified Chinese. Keep code, identifiers, commands, file paths, and exact error messages unchanged when appropriate.",
  },
]

export function supportedLanguages() {
  return localeDefinitions.map((locale) => locale.id)
}

export function localeDefinition(language: DoCodeLanguage) {
  return localeDefinitions.find((locale) => locale.id === language) ?? localeDefinitions[0]!
}

export function isSupportedLanguage(value: unknown): value is DoCodeLanguage {
  return typeof value === "string" && localeDefinitions.some((locale) => locale.id === value)
}

export function normalizeLocale(value: string): DoCodeLanguage | null {
  const normalized = value.trim().toLowerCase()
  return localeDefinitions.find((locale) => locale.aliases.includes(normalized))?.id ?? null
}
