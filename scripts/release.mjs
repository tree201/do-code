import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { execSync } from "node:child_process"

const projectRoot = path.resolve(import.meta.dirname, "..")
const rootPkg = path.join(projectRoot, "package.json")
const cliPkg = path.join(projectRoot, "packages", "cli", "package.json")
const changelog = path.join(projectRoot, "CHANGELOG.md")

function die(message) {
  console.error(`release: ${message}`)
  process.exit(1)
}

function bump(version, kind) {
  const parts = version.split(".").map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) die(`invalid version: ${version}`)
  if (kind === "major") return `${parts[0] + 1}.0.0`
  if (kind === "minor") return `${parts[0]}.${parts[1] + 1}.0`
  if (kind === "patch") return `${parts[0]}.${parts[1]}.${parts[2] + 1}`
  die(`unknown bump kind: ${kind}`)
}

function parseArgs(argv) {
  const args = argv.slice(2)
  if (!args.length) die("usage: npm run release -- <version | major | minor | patch>")
  return args[0]
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"))
}

async function writeJson(file, data) {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`)
}

function runGit(args) {
  return execSync(`git ${args}`, { cwd: projectRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
}

function runNpm(args) {
  execSync(`npm ${args}`, { cwd: projectRoot, stdio: "inherit" })
}

async function main() {
  const input = parseArgs(process.argv)
  if (runGit("status --porcelain")) die("working tree must be clean before releasing")
  const root = await readJson(rootPkg)
  const cli = await readJson(cliPkg)
  const current = root.version
  const next = input === "major" || input === "minor" || input === "patch"
    ? bump(current, input)
    : input.replace(/^v/, "")

  if (next === current) die(`version ${next} is the same as current`)
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) die(`invalid version: ${next}`)

  const date = new Date().toISOString().slice(0, 10)

  root.version = next
  await writeJson(rootPkg, root)

  cli.version = next
  cli.dependencies["@tree201/markdansi"] = root.dependencies["@tree201/markdansi"]
  await writeJson(cliPkg, cli)
  runNpm("install --package-lock-only --ignore-scripts")

  const text = await readFile(changelog, "utf8")
  const updated = text.replace(
    /^## Unreleased\n\n((?:- .+\n)+)/,
    `## Unreleased\n\n## ${next} - ${date}\n\n$1`,
  )
  if (updated === text) die("could not find Unreleased section with entries in CHANGELOG.md")
  await writeFile(changelog, updated)

  runGit(`add ${path.relative(projectRoot, rootPkg)} ${path.relative(projectRoot, cliPkg)} ${path.relative(projectRoot, changelog)}`)
  runGit(`commit -m "release: v${next}"`)
  runGit(`tag v${next}`)
  runGit(`push origin main`)
  runGit(`push origin v${next}`)

  console.log(`\nReleased v${next}.`)
  console.log(`npm publish will run automatically on GitHub Actions.`)
}

main().catch(die)
