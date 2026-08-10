import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { executeTool } from "../src/tools.js"

test("edit_file requires a unique exact match", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-edit-"))
  await writeFile(path.join(workspace, "a.txt"), "one\ntwo\n", "utf8")
  const context = { workspace, approveShell: async () => false }
  const result = await executeTool(
    "edit_file",
    { path: "a.txt", old_text: "two", new_text: "three" },
    context,
  )
  assert.equal(result.ok, true)
  assert.equal(await readFile(path.join(workspace, "a.txt"), "utf8"), "one\nthree\n")
})

test("list_directory and glob respect project and generated-directory ignores", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-discovery-"))
  await mkdir(path.join(workspace, "src"), { recursive: true })
  await mkdir(path.join(workspace, "node_modules", "pkg"), { recursive: true })
  await mkdir(path.join(workspace, ".do-code"), { recursive: true })
  await writeFile(path.join(workspace, ".gitignore"), "ignored.txt\n", "utf8")
  await writeFile(path.join(workspace, "src", "main.ts"), "export {}\n", "utf8")
  await writeFile(path.join(workspace, "src", "note.md"), "note\n", "utf8")
  await writeFile(path.join(workspace, "ignored.txt"), "ignored\n", "utf8")
  await writeFile(path.join(workspace, "node_modules", "pkg", "index.js"), "ignored\n", "utf8")
  await writeFile(path.join(workspace, ".do-code", "secret.txt"), "secret\n", "utf8")
  const context = { workspace, approveShell: async () => false }

  const listed = await executeTool("list_directory", { path: "." }, context)
  assert.equal(listed.ok, true)
  assert.match(listed.output, /src\//)
  assert.doesNotMatch(listed.output, /node_modules|\.do-code|ignored\.txt/)

  const globbed = await executeTool("glob", { pattern: "**/*.ts" }, context)
  assert.equal(globbed.ok, true)
  assert.equal(globbed.output, "src/main.ts")
})

test("read_many_files accepts globs and reports binary files without leaking content", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-read-many-"))
  await mkdir(path.join(workspace, "src"), { recursive: true })
  await writeFile(path.join(workspace, "src", "a.ts"), "const a = 1\n", "utf8")
  await writeFile(path.join(workspace, "src", "b.ts"), "const b = 2\n", "utf8")
  await writeFile(path.join(workspace, "src", "image.bin"), Buffer.from([1, 0, 2, 3]))
  const context = { workspace, approveShell: async () => false }

  const textFiles = await executeTool("read_many_files", { include: ["src/*.ts"] }, context)
  assert.equal(textFiles.ok, true)
  assert.match(textFiles.output, /--- src\/a\.ts ---/)
  assert.match(textFiles.output, /--- src\/b\.ts ---/)

  const binary = await executeTool("read_many_files", { include: ["src/image.bin"] }, context)
  assert.equal(binary.ok, true)
  assert.match(binary.output, /appears to be binary/)
})

test("read_file rejects binary data and normalizes CRLF line display", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-read-"))
  await writeFile(path.join(workspace, "windows.txt"), "one\r\ntwo\r\n", "utf8")
  await writeFile(path.join(workspace, "binary.dat"), Buffer.from([65, 0, 66]))
  const context = { workspace, approveShell: async () => false }

  const textResult = await executeTool("read_file", { path: "windows.txt" }, context)
  assert.equal(textResult.ok, true)
  assert.equal(textResult.output, "1: one\n2: two\n3: ")
  const binaryResult = await executeTool("read_file", { path: "binary.dat" }, context)
  assert.equal(binaryResult.ok, false)
  assert.match(binaryResult.output, /binary/)
})

test("search supports file globs, literal queries, context, and result limits", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-search-"))
  await writeFile(path.join(workspace, "a.ts"), "before\na+b\na+b\nafter\n", "utf8")
  await writeFile(path.join(workspace, "b.md"), "a+b\n", "utf8")
  const result = await executeTool(
    "search",
    { query: "a+b", path: ".", glob: "*.ts", fixed_strings: true, context: 1, max_results: 3 },
    { workspace, approveShell: async () => false },
  )

  assert.equal(result.ok, true)
  assert.match(result.output, /a\.ts/)
  assert.doesNotMatch(result.output, /b\.md/)
  assert.match(result.output, /more result lines/)
})

test("real path checks reject symbolic-link workspace escapes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "do-code-symlink-"))
  const workspace = path.join(root, "workspace"), outside = path.join(root, "outside")
  await mkdir(workspace); await mkdir(outside)
  await writeFile(path.join(outside, "secret.txt"), "secret")
  await symlink(outside, path.join(workspace, "linked"))
  const result = await executeTool("read_file", { path: "linked/secret.txt" }, { workspace, approveShell: async () => false })
  assert.equal(result.ok, false)
  assert.match(result.output, /symbolic link/)
})

test("apply_patch updates multiple workspace files through one tool call", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-apply-patch-"))
  await writeFile(path.join(workspace, "a.txt"), "old\n")
  await writeFile(path.join(workspace, "b.txt"), "before\n")
  const patch = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-before\n+after\n"
  const result = await executeTool("apply_patch", { patch }, { workspace, approveShell: async () => false })
  assert.equal(result.ok, true, result.output)
  assert.equal(await readFile(path.join(workspace, "a.txt"), "utf8"), "new\n")
  assert.equal(await readFile(path.join(workspace, "b.txt"), "utf8"), "after\n")
})
