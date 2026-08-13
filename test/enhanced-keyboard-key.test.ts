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

test("normalizes Kitty Escape with or without the leading Escape byte", () => {
  for (const rawInput of ["[27;1u", "\u001b[27;1u"]) {
    const normalized = normalizeEnhancedKeyboardKey(rawInput, emptyKey)
    assert.equal(normalized.input, "")
    assert.equal(normalized.key.escape, true)
  }
})

test("normalizes Kitty Shift+Tab without inserting a control character", () => {
  const normalized = normalizeEnhancedKeyboardKey("[9;2u", emptyKey)
  assert.equal(normalized.input, "")
  assert.equal(normalized.key.shift, true)
  assert.equal(normalized.key.tab, true)
})

test("normalizes terminal and Kitty arrow encodings without inserting escape sequences", () => {
  const inputs: Array<[string, "leftArrow" | "rightArrow", { ctrl?: boolean }]> = [
    ["\u001b[D", "leftArrow", {}],
    ["[C", "rightArrow", {}],
    ["\u001b[1;5D", "leftArrow", { ctrl: true }],
    ["[57350;1u", "leftArrow", {}],
    ["\u001b[57351;5u", "rightArrow", { ctrl: true }],
  ]
  for (const [rawInput, direction, modifiers] of inputs) {
    const normalized = normalizeEnhancedKeyboardKey(rawInput, emptyKey)
    assert.equal(normalized.input, "")
    assert.equal(normalized.key[direction], true)
    assert.equal(Boolean(normalized.key.ctrl), Boolean(modifiers.ctrl))
  }
})

test("normalizes a plain Escape byte", () => {
  const normalized = normalizeEnhancedKeyboardKey("\u001b", emptyKey)
  assert.equal(normalized.input, "")
  assert.equal(normalized.key.escape, true)
})

test("normalizes ordinary Ctrl-letter control bytes", () => {
  const controls: Array<[string, string]> = [["\u0007", "g"], ["\u0008", "h"], ["\u0012", "r"], ["\u0014", "t"], ["\u0015", "u"], ["\u0016", "v"], ["\u0019", "y"]]
  for (const [rawInput, letter] of controls) {
    const normalized = normalizeEnhancedKeyboardKey(rawInput, emptyKey)
    assert.equal(normalized.input, letter)
    assert.equal(normalized.key.ctrl, true)
  }
})

test("normalizes uppercase enhanced Ctrl letters for all editor shortcuts", () => {
  const shortcuts: Array<[number, string]> = [[65, "a"], [67, "c"], [68, "d"], [69, "e"], [71, "g"], [72, "h"], [74, "j"], [82, "r"], [84, "t"], [85, "u"], [86, "v"], [89, "y"], [90, "z"]]
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
