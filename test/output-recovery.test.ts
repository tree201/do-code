import assert from "node:assert/strict"
import test from "node:test"
import {
  appendRecoveryContinuation,
  clampOutputTokens,
  DEFAULT_MAX_OUTPUT_TOKENS,
  ESCALATED_MAX_OUTPUT_TOKENS,
  outputRecoveryMessage,
} from "../src/output-recovery.js"

test("output budget starts at 32K and expands up to 64K when context room allows", () => {
  assert.equal(clampOutputTokens(DEFAULT_MAX_OUTPUT_TOKENS, 128_000, 8_000), 32_000)
  assert.equal(clampOutputTokens(ESCALATED_MAX_OUTPUT_TOKENS, 128_000, 8_000), 64_000)
})

test("output budget is clamped to the remaining context room", () => {
  assert.equal(clampOutputTokens(ESCALATED_MAX_OUTPUT_TOKENS, 128_000, 80_000), 38_000)
})

test("recovery continuation removes overlap and limits prompt tail size", () => {
  assert.equal(
    appendRecoveryContinuation("first\nshared continuation", "shared continuation\nsecond"),
    "first\nshared continuation\nsecond",
  )
  const message = outputRecoveryMessage("x".repeat(2_000))
  assert.ok(message.length < 1_600)
  assert.match(message, /Resume directly/)
})
