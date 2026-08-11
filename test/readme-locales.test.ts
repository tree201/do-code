import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"
import { localeDefinitions } from "../src/locale-registry.js"

const readmeByLanguage = {
  en: "README.md",
  zh: "README.zh-CN.md",
  ja: "README.ja-JP.md",
  ko: "README.ko-KR.md",
  es: "README.es-ES.md",
  fr: "README.fr-FR.md",
} as const

const languageNavigation = Object.entries(readmeByLanguage)
  .map(([language, file]) => {
    const locale = localeDefinitions.find((candidate) => candidate.id === language)
    return `[${locale?.nativeName}](${file})`
  })
  .join(" | ")

test("localized READMEs match every supported interface language", async () => {
  assert.deepEqual(Object.keys(readmeByLanguage), localeDefinitions.map((locale) => locale.id))
  for (const file of Object.values(readmeByLanguage)) {
    const readme = await readFile(resolve(import.meta.dirname, "..", file), "utf8")
    assert.ok(readme.includes(languageNavigation), `${file} is missing the shared language navigation`)
  }
})
