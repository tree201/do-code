import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { applyToolGitPatch, toolPatchPaths } from "../src/tool-patch.js"

test("patch path parsing ignores dev null and de-duplicates Git prefixes", () => {
  const patch = "--- a/old.txt\n+++ /dev/null\n--- /dev/null\n+++ b/new.txt\n--- a/same.txt\n+++ b/same.txt\n"
  assert.deepEqual(toolPatchPaths(patch), ["old.txt", "new.txt", "same.txt"])
  assert.deepEqual(toolPatchPaths("not a patch"), [])
})

test("patch application updates files and reports invalid patches", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-patch-"))
  await writeFile(path.join(workspace, "file.txt"), "old\n")
  const applied = await applyToolGitPatch(workspace, "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n")
  assert.deepEqual(applied, { ok: true, output: "Patch applied" })
  assert.equal(await readFile(path.join(workspace, "file.txt"), "utf8"), "new\n")
  const invalid = await applyToolGitPatch(workspace, "invalid patch")
  assert.equal(invalid.ok, false)
  assert.match(invalid.output, /patch|input/i)
})
