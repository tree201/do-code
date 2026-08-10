import { readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const root = process.cwd()
const baselineFile = path.join(root, "docs", "file-size-baseline.json")
const maxLines = 300
const extensions = new Set([".ts", ".tsx"])
const ignoredDirectories = new Set(["node_modules", "dist", "build", "coverage", ".git"])

async function filesUnder(directory) {
  const entries = await (await import("node:fs/promises")).readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesUnder(target))
    else if (extensions.has(path.extname(entry.name))) files.push(target)
  }
  return files
}

const baseline = JSON.parse(await readFile(baselineFile, "utf8"))
const files = [
  ...await filesUnder(path.join(root, "src")),
  ...await filesUnder(path.join(root, "test")),
]
const failures = []
const migrated = []
for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join("/")
  const lines = (await readFile(file, "utf8")).split(/\r?\n/).length - 1
  if (lines <= maxLines) continue
  if (baseline.files?.[relative] !== undefined) migrated.push(`${relative}: ${lines} lines (baseline ${baseline.files[relative]})`)
  else failures.push(`${relative}: ${lines} lines; maximum allowed is ${maxLines}`)
}
for (const item of migrated) process.stdout.write(`file-size migration: ${item}\n`)
if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`)
  process.exitCode = 1
}
