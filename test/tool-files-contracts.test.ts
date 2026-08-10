import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { decodeToolText, discoverToolFiles, readToolTextFile } from "../src/tool-files.js"

const context = (workspace: string) => ({ workspace, approveShell: async () => false })

test("file helpers reject binary and invalid UTF-8 content", () => {
  assert.throws(() => decodeToolText(Buffer.from("text\0hidden"), "binary.dat"), /File appears to be binary: binary.dat/)
  assert.throws(() => decodeToolText(Buffer.from([0xc3, 0x28]), "invalid.txt"), /File is not valid UTF-8 text: invalid.txt/)
  assert.equal(decodeToolText(Buffer.from("one\r\ntwo"), "text.txt"), "one\r\ntwo")
})

test("file helpers discover ignored files and read bounded UTF-8 files", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-files-"))
  await writeFile(path.join(workspace, ".gitignore"), "ignored.txt\n")
  await writeFile(path.join(workspace, "visible.txt"), "hello")
  await writeFile(path.join(workspace, "ignored.txt"), "secret")
  assert.deepEqual(await discoverToolFiles(context(workspace), "."), [".gitignore", "visible.txt"])
  assert.equal(await readToolTextFile(context(workspace), "visible.txt"), "hello")
  await assert.rejects(readToolTextFile(context(workspace), "missing.txt"), /ENOENT/)
  await assert.rejects(readToolTextFile(context(workspace), "."), /Path is not a file/)
  assert.equal(await readFile(path.join(workspace, "visible.txt"), "utf8"), "hello")
})
