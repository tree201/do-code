import { readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const root = process.cwd()
const baseline = JSON.parse(await readFile(path.join(root, "docs", "hardcoded-baseline.json"), "utf8"))
const extensions = new Set([".ts", ".tsx"])
const ignoredDirectories = new Set(["node_modules", "dist", "build", "coverage", ".git"])
const rules = [
  { name: "slash command", pattern: /["'`]\/(?:help|status|stats|compact|model|auth|resume|rename|export|rewind|restore|plan|permissions|trust|bug|memory|language|effort|thinking|extensions)(?:\s|["'`]|$)/ },
  { name: "tool name", pattern: /["'`](?:read_file|write_file|edit_file|apply_patch|shell|web_fetch|web_search|ask_user|todo_write|enter_plan_mode|exit_plan_mode)["'`]/ },
  { name: "environment variable", pattern: /["'`](?:MODEL_API_KEY|MODEL_BASE_URL|MODEL_ID|DO_CODE_[A-Z0-9_]+|QWEN_CODE_[A-Z0-9_]+)["'`]/ },
  { name: "large limit", pattern: /\b(?:300|1024|4096|8192|20000|40000|120000|300000|1000000)\b/ },
]

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

const failures = []
for (const file of await filesUnder(path.join(root, "src"))) {
  const relative = path.relative(root, file).split(path.sep).join("/")
  if (baseline.paths?.includes(relative)) continue
  const lines = (await readFile(file, "utf8")).split(/\r?\n/)
  lines.forEach((line, index) => {
    if (/\b(?:const|let)\s+[A-Z][A-Z0-9_]*\b/.test(line)) return
    for (const rule of rules) if (rule.pattern.test(line)) failures.push(`${relative}:${index + 1}: ${rule.name}: ${line.trim()}`)
  })
}
if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`)
  process.exitCode = 1
}
