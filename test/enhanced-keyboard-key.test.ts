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

test("normalizes a plain Escape byte", () => {
  const normalized = normalizeEnhancedKeyboardKey("\u001b", emptyKey)
  assert.equal(normalized.input, "")
  assert.equal(normalized.key.escape, true)
})

test("preserves ordinary Ink input", () => {
  const key = { shift: true } as ChatInputKey
  const normalized = normalizeEnhancedKeyboardKey("A", key)
  assert.equal(normalized.input, "A")
  assert.deepEqual(normalized.key, key)
})
