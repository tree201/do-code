import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { InstructionMemory } from "../src/instructions.js"

test("loads global and repository instructions in broad-to-specific order", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "do-code-memory-"))
  const config = path.join(root, "config")
  const repository = path.join(root, "repo")
  const workspace = path.join(repository, "packages", "app")
  await mkdir(path.join(repository, ".git"), { recursive: true })
  await mkdir(config, { recursive: true })
  await mkdir(workspace, { recursive: true })
  await writeFile(path.join(config, "AGENTS.md"), "global rule", "utf8")
  await writeFile(path.join(repository, "AGENTS.md"), "root rule", "utf8")
  await writeFile(path.join(repository, "packages", "AGENTS.md"), "packages rule", "utf8")
  await writeFile(path.join(workspace, "AGENTS.md"), "app rule", "utf8")

  const memory = new InstructionMemory(workspace, config)
  const sources = await memory.list()
  assert.deepEqual(sources.map((source) => source.content), ["global rule", "root rule", "packages rule", "app rule"])
  const prompt = await memory.prompt()
  assert.ok(prompt.indexOf("global rule") < prompt.indexOf("root rule"))
  assert.ok(prompt.indexOf("root rule") < prompt.indexOf("app rule"))
  assert.match(prompt, /<global_context>/)
  assert.match(prompt, /<project_context>/)
})

test("discovers subdirectory instructions lazily and reloads modified content", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-jit-memory-"))
  const nested = path.join(workspace, "src", "feature")
  await mkdir(path.join(workspace, ".git"), { recursive: true })
  await mkdir(nested, { recursive: true })
  await writeFile(path.join(nested, "AGENTS.md"), "feature rule v1", "utf8")
  await writeFile(path.join(nested, "index.ts"), "export {}\n", "utf8")
  const memory = new InstructionMemory(workspace, null)

  assert.equal((await memory.list()).length, 0)
  const added = await memory.discover("src/feature/index.ts")
  assert.equal(added.length, 1)
  assert.equal(added[0]?.content, "feature rule v1")
  assert.equal((await memory.discover("src/feature/other.ts")).length, 0)

  await writeFile(path.join(nested, "AGENTS.md"), "feature rule v2", "utf8")
  const reloaded = await memory.reload()
  assert.equal(reloaded.at(-1)?.content, "feature rule v2")
})
