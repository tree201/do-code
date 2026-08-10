import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { CheckpointManager } from "../src/checkpoints.js"

test("restores modified files and removes files created after a checkpoint", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-checkpoint-"))
  const manager = new CheckpointManager(workspace, "test")
  await writeFile(path.join(workspace, "existing.txt"), "before\n", "utf8")
  const existing = await manager.create("edit_file", "existing.txt", 3)
  await writeFile(path.join(workspace, "existing.txt"), "after\n", "utf8")
  await manager.restore(existing.id)
  assert.equal(await readFile(path.join(workspace, "existing.txt"), "utf8"), "before\n")

  const created = await manager.create("write_file", "new.txt", 4)
  await writeFile(path.join(workspace, "new.txt"), "new\n", "utf8")
  await manager.restore(created.id)
  await assert.rejects(readFile(path.join(workspace, "new.txt")), /ENOENT/)
})

test("checkpoint content blobs are deduplicated and legacy base64 remains readable", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-checkpoint-blobs-"))
  const manager = new CheckpointManager(workspace, "test")
  await writeFile(path.join(workspace, "same.txt"), "same content\n", "utf8")
  const first = await manager.create("edit_file", "same.txt")
  const second = await manager.create("edit_file", "same.txt")
  assert.equal(first.contentBlob, second.contentBlob)
  assert.equal((await readdir(manager.blobDirectory)).length, 1)
  assert.equal(first.contentBase64, undefined)

  const legacy = { id: "cp_legacy", createdAt: new Date().toISOString(), tool: "edit_file", path: "legacy.txt", existed: true, contentBase64: Buffer.from("legacy\n").toString("base64"), messageCount: 0 }
  await mkdir(manager.directory, { recursive: true })
  await writeFile(path.join(manager.directory, `${legacy.id}.json`), JSON.stringify(legacy), "utf8")
  await manager.restore(legacy.id)
  assert.equal(await readFile(path.join(workspace, "legacy.txt"), "utf8"), "legacy\n")
})
