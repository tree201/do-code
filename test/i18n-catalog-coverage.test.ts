import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { hasExplicitTranslation } from "../src/ui/i18n.js"
import type { DoCodeLanguage } from "../src/config.js"

const languages: DoCodeLanguage[] = ["zh", "ja", "ko", "es", "fr"]
const callPattern = /\bt\(\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*,\s*(["'])((?:\\.|(?!\1)[^\\])*?)\1/g

function unescapeLiteral(value: string) {
  return value.replace(/\\([\\'"nrt])/g, (_, character: string) => ({ n: "\n", r: "\r", t: "\t" })[character] ?? character)
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) ? [file] : []
  }))
  return nested.flat()
}

test("static t(language, literal) calls have explicit translations", async () => {
  const keys = new Set<string>()
  const sourceDirectory = path.resolve("src")
  for (const file of await sourceFiles(sourceDirectory)) {
    if (file === path.join(sourceDirectory, "ui", "i18n.ts")) continue
    const source = await readFile(file, "utf8")
    for (const match of source.matchAll(callPattern)) keys.add(unescapeLiteral(match[2]!))
  }

  const missing = languages.flatMap((language) => [...keys].filter((key) => !hasExplicitTranslation(language, key)).map((key) => `${language}: ${key}`))
  assert.deepEqual(missing, [], `Missing explicit translations:\n${missing.join("\n")}`)
})
