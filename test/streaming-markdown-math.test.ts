import assert from "node:assert/strict"
import test from "node:test"
import { splitStreamingMarkdown } from "../src/ui/streaming-markdown.js"

test("streaming markdown keeps display math pending until its block boundary", () => {
  const open = splitStreamingMarkdown("Intro\n\n$$\n\\Gamma\\times X")
  assert.equal(open.stable, "Intro\n\n")
  assert.equal(open.pending, "$$\n\\Gamma\\times X")

  const closed = splitStreamingMarkdown("Intro\n\n$$\n\\Gamma\\times X\n$$\n\nTail", open.committedLength)
  assert.equal(closed.stable, "$$\n\\Gamma\\times X\n$$\n\n")
  assert.equal(closed.pending, "Tail")
})
