import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
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
