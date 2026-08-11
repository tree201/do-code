import assert from "node:assert/strict"
import test from "node:test"
import { CliArgumentError, parseArgs, usage } from "../src/cli-args.js"
import { exitCodeForCliError } from "../src/cli-errors.js"
import { EXIT_CODES } from "../src/headless.js"

class HelpExit extends Error {
  constructor(readonly code: number | undefined) {
    super("help exit")
  }
}

test("--language ja sends localized help through usage", () => {
  const originalLog = console.log
  const originalExit = process.exit
  let output = ""
  console.log = (message?: unknown) => {
    output = String(message)
  }
  process.exit = ((code?: number) => {
    throw new HelpExit(code)
  }) as typeof process.exit

  try {
    assert.throws(
      () => parseArgs(["--language", "ja", "--help"]),
      (error: unknown) => error instanceof HelpExit && error.code === 0,
    )
  } finally {
    console.log = originalLog
    process.exit = originalExit
  }

  assert.equal(output, usage("ja"))
  assert.match(output, /使い方/)
})

test("--language zh localizes invalid options as argument errors", () => {
  let thrown: unknown
  try {
    parseArgs(["--language", "zh", "--not-an-option"])
  } catch (error) {
    thrown = error
  }

  assert.ok(thrown instanceof CliArgumentError)
  assert.match(thrown.message, /未知.*--not-an-option/)
  assert.equal(exitCodeForCliError(thrown), EXIT_CODES.argument)
})

test("--language may be supplied only once", () => {
  assert.throws(
    () => parseArgs(["--language", "ja", "--language", "bad"]),
    (error: unknown) => error instanceof CliArgumentError && error.message.includes("--language"),
  )
})
