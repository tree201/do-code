import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { expandFileReferences, expandPromptContent } from "../src/file-context.js"

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0])

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

test("image references become session-relative multimodal attachments", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-image-context-"))
  const attachmentDirectory = path.join(workspace, ".do-code", "sessions", "test", "attachments")
  await writeFile(path.join(workspace, "bug.png"), PNG)
  const content = await expandPromptContent("请检查这个界面 @bug.png", workspace, attachmentDirectory)
  assert.ok(Array.isArray(content))
  if (!Array.isArray(content)) return
  assert.deepEqual(content[0], { type: "text", text: "请检查这个界面 @bug.png" })
  assert.equal(content[1]?.type, "image")
  if (content[1]?.type !== "image") return
  assert.equal(content[1].mimeType, "image/png")
  assert.match(content[1].path, /^attachments\/image_.+\.png$/)
  assert.equal(content[1].name, "bug.png")
  assert.deepEqual(await readFile(path.join(path.dirname(attachmentDirectory), content[1].path)), PNG)
})

test("existing session image references are reused without copying", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-session-attachment-"))
  const attachmentDirectory = path.join(workspace, ".do-code", "sessions", "test", "attachments")
  await mkdir(path.join(path.dirname(attachmentDirectory), "attachments"), { recursive: true })
  await writeFile(path.join(attachmentDirectory, "image.png"), PNG)
  const content = await expandPromptContent("检查 @attachments/image.png", workspace, attachmentDirectory)
  assert.ok(Array.isArray(content))
  if (!Array.isArray(content)) return
  const image = content.find((part) => part.type === "image")
  assert.equal(image?.type, "image")
  if (image?.type !== "image") return
  assert.equal(image.path, "attachments/image.png")
  assert.deepEqual(await readFile(path.join(path.dirname(attachmentDirectory), image.path)), PNG)
})

test("image references enforce count and total size limits", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-image-limits-"))
  const attachmentDirectory = path.join(workspace, ".do-code", "sessions", "test", "attachments")
  await Promise.all(["one", "two", "three", "four", "five"].map((name) => writeFile(path.join(workspace, `${name}.png`), PNG)))
  await assert.rejects(
    expandPromptContent("@one.png @two.png @three.png @four.png @five.png", workspace, attachmentDirectory),
    /at most 4 images/,
  )
})

test("image references reject extension and content mismatches", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-image-mismatch-"))
  await writeFile(path.join(workspace, "bug.jpg"), PNG)
  await assert.rejects(
    expandPromptContent("检查 @bug.jpg", workspace, path.join(workspace, ".do-code", "sessions", "test", "attachments")),
    /Image extension does not match its content/,
  )
})
