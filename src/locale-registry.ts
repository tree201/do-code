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
  {
    id: "ja",
    aliases: ["ja", "ja-jp", "japanese", "日本語", "日语"],
    nativeName: "日本語",
    englishName: "Japanese",
    bcp47: "ja-JP",
    outputInstruction: "Respond to the user in Japanese. Keep code, identifiers, commands, file paths, and exact error messages unchanged when appropriate.",
  },
  {
    id: "ko",
    aliases: ["ko", "ko-kr", "korean", "한국어", "韩语"],
    nativeName: "한국어",
    englishName: "Korean",
    bcp47: "ko-KR",
    outputInstruction: "Respond to the user in Korean. Keep code, identifiers, commands, file paths, and exact error messages unchanged when appropriate.",
  },
  {
    id: "es",
    aliases: ["es", "es-es", "spanish", "español", "西班牙语"],
    nativeName: "Español",
    englishName: "Spanish",
    bcp47: "es-ES",
    outputInstruction: "Respond to the user in Spanish. Keep code, identifiers, commands, file paths, and exact error messages unchanged when appropriate.",
  },
  {
    id: "fr",
    aliases: ["fr", "fr-fr", "french", "français", "法语"],
    nativeName: "Français",
    englishName: "French",
    bcp47: "fr-FR",
    outputInstruction: "Respond to the user in French. Keep code, identifiers, commands, file paths, and exact error messages unchanged when appropriate.",
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
