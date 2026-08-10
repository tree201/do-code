import assert from "node:assert/strict"
import test from "node:test"
import { DISABLE_ENHANCED_KEYBOARD_INPUT, ENABLE_ENHANCED_KEYBOARD_INPUT, enableEnhancedKeyboardInput } from "../src/ui/enhanced-keyboard-input.js"

function createLifecycle() {
  let exitListener: (() => void) | undefined
  return {
    once(event: "exit", listener: () => void) {
      assert.equal(event, "exit")
      exitListener = listener
    },
    off(event: "exit", listener: () => void) {
      assert.equal(event, "exit")
      if (exitListener === listener) exitListener = undefined
    },
    exit() { exitListener?.() },
    hasExitListener() { return exitListener !== undefined },
  }
}

test("enhanced keyboard input enables terminal protocols and restores them once", () => {
  const writes: string[] = []
  const lifecycle = createLifecycle()
  const restore = enableEnhancedKeyboardInput(
    { isTTY: true },
    { isTTY: true, write(chunk) { writes.push(chunk) } },
    lifecycle,
  )

  assert.deepEqual(writes, [ENABLE_ENHANCED_KEYBOARD_INPUT])
  assert.equal(lifecycle.hasExitListener(), true)
  restore()
  restore()
  lifecycle.exit()
  assert.deepEqual(writes, [ENABLE_ENHANCED_KEYBOARD_INPUT, DISABLE_ENHANCED_KEYBOARD_INPUT])
  assert.equal(lifecycle.hasExitListener(), false)
})

test("enhanced keyboard input remains inactive outside a TTY", () => {
  const writes: string[] = []
  const lifecycle = createLifecycle()
  const restore = enableEnhancedKeyboardInput(
    { isTTY: false },
    { isTTY: true, write(chunk) { writes.push(chunk) } },
    lifecycle,
  )

  restore()
  assert.deepEqual(writes, [])
  assert.equal(lifecycle.hasExitListener(), false)
})
