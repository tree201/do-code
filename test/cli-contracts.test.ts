import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import { exitCodeForCliError, requestedOutputFormat } from "../src/cli-errors.js"
import { EXIT_CODES } from "../src/headless.js"
import { composeHeadlessTask, imageTaskReferences } from "../src/cli-task.js"

test("headless task composition preserves stdin, argument, and image order", () => {
  assert.equal(
    composeHeadlessTask("from stdin", "from argument", ["@one.png", "@nested/two.jpg"]),
    "from stdin\n\nfrom argument\n@one.png @nested/two.jpg",
  )
  assert.equal(composeHeadlessTask("", "", ["@only.png"]), "@only.png")
  assert.throws(() => composeHeadlessTask("", "", []), /Task must not be empty/)
})

test("headless image references stay workspace-relative", () => {
  const workspace = path.resolve("workspace")
  assert.deepEqual(imageTaskReferences(workspace, ["one.png", "nested/two.jpg"]), ["@one.png", "@nested/two.jpg"])
  assert.throws(() => imageTaskReferences(workspace, ["../outside.png"]), /Image must be inside the workspace/)
})

test("CLI error formatting and exit classification remain protocol-stable", () => {
  assert.equal(requestedOutputFormat(["run", "--json"]), "json")
  assert.equal(requestedOutputFormat(["run", "--output-format", "stream-json"]), "stream-json")
  assert.equal(requestedOutputFormat(["run"]), "text")
  assert.equal(exitCodeForCliError("Task must not be empty"), EXIT_CODES.argument)
  assert.equal(exitCodeForCliError("No model is configured"), EXIT_CODES.model)
  assert.equal(exitCodeForCliError("Unexpected failure"), EXIT_CODES.unknown)
})
