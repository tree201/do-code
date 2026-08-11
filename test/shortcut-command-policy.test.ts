import assert from "node:assert/strict"
import test from "node:test"
import { isHelpShortcut, isReasoningEffortShortcut } from "../src/ui/shortcut-command-policy.js"

test("Ctrl+H is recognized as the help shortcut for both terminal encodings", () => {
  assert.equal(isHelpShortcut("h", { ctrl: true }), true)
  assert.equal(isHelpShortcut("", { backspace: true }), true)
  assert.equal(isHelpShortcut("h", {}), false)
})

test("Ctrl+R is recognized as the reasoning effort shortcut", () => {
  assert.equal(isReasoningEffortShortcut("r", { ctrl: true }), true)
  assert.equal(isReasoningEffortShortcut("r", {}), false)
})
