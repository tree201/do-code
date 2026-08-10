import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { imageData, inlineImageUrl, requireImageSupport } from "../src/model-content.js"

test("model content validation accepts supported image data URLs and rejects malformed ones", () => {
  assert.deepEqual(inlineImageUrl("data:image/png;base64,AAAA"), { mimeType: "image/png", data: "AAAA" })
  assert.throws(() => inlineImageUrl("https://example.com/image.png"), /Provider-native image conversion requires/)
  assert.throws(() => requireImageSupport([{ role: "user", content: [{ type: "image", path: "image.png", mimeType: "image/png" }] }], false, "text-model"), /does not support image input/)
})

test("model image conversion reuses unchanged attachment encodings", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "do-code-image-cache-"))
  const file = path.join(directory, "image.png")
  await writeFile(file, Buffer.from("cached image"))
  const part = { type: "image" as const, path: file, mimeType: "image/png" as const }
  const first = await imageData(part)
  const second = await imageData(part)
  assert.strictEqual(second, first)
  await writeFile(file, Buffer.from("changed image content"))
  assert.notStrictEqual(await imageData(part), first)
})
