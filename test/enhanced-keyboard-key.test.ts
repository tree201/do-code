import assert from "node:assert/strict"
import test from "node:test"
import { normalizeEnhancedKeyboardKey } from "../src/ui/enhanced-keyboard-key.js"
import type { ChatInputKey } from "../src/ui/input-routing-types.js"

const emptyKey = {} as ChatInputKey

test("normalizes Kitty Ctrl+C without leaking its escape sequence", () => {
  const normalized = normalizeEnhancedKeyboardKey("[99;5u", emptyKey)
  assert.equal(normalized.input, "c")
  assert.equal(normalized.key.ctrl, true)
  assert.equal(normalized.key.return, undefined)
})

test("normalizes enhanced Ctrl+Enter encodings", () => {
  for (const rawInput of ["[13;5u", "[27;5;13~"]) {
    const normalized = normalizeEnhancedKeyboardKey(rawInput, emptyKey)
    assert.equal(normalized.input, "\r")
    assert.equal(normalized.key.ctrl, true)
    assert.equal(normalized.key.return, true)
  }
})

test("normalizes Kitty Escape without leaking a control character", () => {
  const normalized = normalizeEnhancedKeyboardKey("[27;1u", emptyKey)
  assert.equal(normalized.input, "")
  assert.equal(normalized.key.escape, true)
})

test("normalizes Kitty Shift+Tab without inserting a control character", () => {
  const normalized = normalizeEnhancedKeyboardKey("[9;2u", emptyKey)
  assert.equal(normalized.input, "")
  assert.equal(normalized.key.shift, true)
  assert.equal(normalized.key.tab, true)
})

test("normalizes a plain Escape byte", () => {
  const normalized = normalizeEnhancedKeyboardKey("\u001b", emptyKey)
  assert.equal(normalized.input, "")
  assert.equal(normalized.key.escape, true)
})

test("normalizes ordinary Ctrl-letter control bytes", () => {
  const controls: Array<[string, string]> = [["\u0008", "h"], ["\u0012", "r"], ["\u0014", "t"], ["\u0015", "u"], ["\u0016", "v"], ["\u0019", "y"]]
  for (const [rawInput, letter] of controls) {
    const normalized = normalizeEnhancedKeyboardKey(rawInput, emptyKey)
    assert.equal(normalized.input, letter)
    assert.equal(normalized.key.ctrl, true)
  }
})

test("normalizes uppercase enhanced Ctrl letters for all editor shortcuts", () => {
  const shortcuts: Array<[number, string]> = [[65, "a"], [67, "c"], [68, "d"], [69, "e"], [72, "h"], [74, "j"], [82, "r"], [84, "t"], [85, "u"], [86, "v"], [89, "y"], [90, "z"]]
  for (const [codepoint, expected] of shortcuts) {
    const normalized = normalizeEnhancedKeyboardKey(`[${codepoint};5u`, emptyKey)
    assert.equal(normalized.input, expected)
    assert.equal(normalized.key.ctrl, true)
  }
})

test("normalizes modifyOtherKeys Ctrl letters", () => {
  const normalized = normalizeEnhancedKeyboardKey("[27;5;72~", emptyKey)
  assert.equal(normalized.input, "h")
  assert.equal(normalized.key.ctrl, true)
})

test("preserves ordinary Ink input", () => {
  const key = { shift: true } as ChatInputKey
  const normalized = normalizeEnhancedKeyboardKey("A", key)
  assert.equal(normalized.input, "A")
  assert.deepEqual(normalized.key, key)
})
