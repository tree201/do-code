#!/usr/bin/env node

/**
 * Stable production launcher for do-code.
 *
 * Keep this file plain JavaScript with no package-local imports: it must be
 * able to explain an unsupported runtime before loading the compiled CLI.
 * The real CLI is launched with the exact Node executable that entered this
 * wrapper, preventing PATH changes in child processes from selecting another
 * Node installation.
 */

import { existsSync, realpathSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const [majorText, minorText] = process.versions.node.split(".")
const currentNodeMajor = Number.parseInt(majorText ?? "", 10)
const currentNodeMinor = Number.parseInt(minorText ?? "", 10)

// Vite 8, used by the source workspace, supports the same
// runtime range. Keep the global CLI and source checkout predictable.
const supportedRuntime =
  (currentNodeMajor === 20 && Number.isInteger(currentNodeMinor) && currentNodeMinor >= 19) ||
  (Number.isInteger(currentNodeMajor) && currentNodeMajor >= 22 &&
    (currentNodeMajor > 22 || (Number.isInteger(currentNodeMinor) && currentNodeMinor >= 12)))

if (!supportedRuntime) {
  process.stderr.write(
    `do-code requires Node.js 20.19+ or 22.12+. Current: ${process.version}\n` +
    "Install a supported Node.js runtime, make it active in this terminal, and run do-code again.\n",
  )
  process.exit(1)
}

const entryDirectory = dirname(fileURLToPath(import.meta.url))
const candidates = [
  join(entryDirectory, "..", "dist", "cli.js"),
  join(entryDirectory, "..", "dist", "src", "cli.js"),
]
const cliPath = candidates.find((candidate) => existsSync(candidate))

if (!cliPath) {
  process.stderr.write(
    `do-code installation is incomplete. Could not find the compiled CLI near ${entryDirectory}.\n` +
    "Reinstall do-code and try again.\n",
  )
  process.exit(1)
}

// Publish the exact entry for nested do-code invocations. This avoids an older
// global installation being selected if PATH changes inside an agent shell.
process.env.DO_CODE_CLI = realpathSync(fileURLToPath(import.meta.url))

const result = spawnSync(
  process.execPath,
  ["--expose-gc", resolve(cliPath), ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
)

if (result.error) {
  process.stderr.write(`Failed to start do-code: ${result.error.message}\n`)
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
