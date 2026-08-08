import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { expandFileReferences, expandPromptContent } from "../src/file-context.js"

test("file references append safe workspace file contents", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-context-"))
  await writeFile(path.join(workspace, "说明.txt"), "需要保留的内容", "utf8")
  const expanded = await expandFileReferences("请检查 @说明.txt", workspace)
  assert.match(expanded, /Referenced file context/)
  assert.match(expanded, /需要保留的内容/)
})

test("file references ignore missing and escaping paths", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-context-safe-"))
  const prompt = "检查 @missing.txt 和 @../../etc/passwd"
  assert.equal(await expandFileReferences(prompt, workspace), prompt)
})

test("image references become OpenAI-compatible multimodal content", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-image-context-"))
  await writeFile(path.join(workspace, "bug.png"), Buffer.from([137, 80, 78, 71, 1, 2, 3]))
  const content = await expandPromptContent("请检查这个界面 @bug.png", workspace)
  assert.ok(Array.isArray(content))
  if (!Array.isArray(content)) return
  assert.deepEqual(content[0], { type: "text", text: "请检查这个界面 @bug.png" })
  assert.equal(content[1]?.type, "image_url")
  if (content[1]?.type === "image_url") assert.match(content[1].image_url.url, /^data:image\/png;base64,/)
})
