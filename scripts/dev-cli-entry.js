#!/usr/bin/env node

import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const projectDirectory = join(dirname(fileURLToPath(import.meta.url)), "..")
const tsxPath = join(projectDirectory, "node_modules", "tsx", "dist", "cli.mjs")
const cliPath = join(projectDirectory, "src", "cli.ts")

if (!existsSync(tsxPath)) {
  process.stderr.write(`do-code-dev requires project dependencies. Run npm install in ${projectDirectory}.\n`)
  process.exit(1)
}

process.env.DO_CODE_CLI = fileURLToPath(import.meta.url)
const result = spawnSync(
  process.execPath,
  ["--expose-gc", tsxPath, cliPath, ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
)

if (result.error) {
  process.stderr.write(`Failed to start do-code-dev: ${result.error.message}\n`)
  process.exit(1)
}

if (result.signal) {
  try {
    process.kill(process.pid, result.signal)
  } catch {
    process.exit(1)
  }
} else {
  process.exit(result.status ?? 1)
}
