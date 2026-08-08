import assert from "node:assert/strict"
import test from "node:test"
import { THINKING_BREATH_INTERVAL_MS, thinkingBreathColors, tuiTheme } from "../src/ui/theme.js"

test("Codex minimal theme reserves color for semantic accents", () => {
  assert.deepEqual(tuiTheme, {
    accent: "cyan",
    success: "green",
    danger: "red",
    warning: "#D29922",
    pending: "gray",
    brand: "magenta",
    border: "gray",
    userMessageBackground: "#2B2B2B",
    diffAddedBackground: "#173B2A",
    diffRemovedBackground: "#482321",
    diffLineNumber: "#737373",
    diffAddedMarker: "#4EC987",
    diffRemovedMarker: "#E06C68",
  })
  assert.ok(!Object.values(tuiTheme).includes("yellow" as never))
  assert.ok(!Object.values(tuiTheme).includes("blue" as never))
})

test("thinking breath keeps a stable white marker while only changing brightness", () => {
  assert.equal(thinkingBreathColors.length, 8)
  assert.equal(thinkingBreathColors.includes("#FFFFFF"), true)
  assert.equal(thinkingBreathColors[0], "#737373")
  assert.equal(thinkingBreathColors[1], thinkingBreathColors.at(-1))
  assert.equal(THINKING_BREATH_INTERVAL_MS * thinkingBreathColors.length, 2_400)
})
