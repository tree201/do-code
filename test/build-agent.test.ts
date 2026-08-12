import assert from "node:assert/strict"
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { cleanBuildOutput } from "../scripts/build-agent.mjs"

test("agent build removes stale compiled files", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "do-code-build-"))
  const staleFile = path.join(projectRoot, "dist", "src", "workspace-trust.js")
  await mkdir(path.dirname(staleFile), { recursive: true })
  await writeFile(staleFile, "stale")

  await cleanBuildOutput(projectRoot)
  await assert.rejects(() => access(staleFile))
})

test("build script uses the clean agent build entry", async () => {
  const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { scripts: Record<string, string> }
  assert.equal(packageJson.scripts["build:agent"], "node scripts/build-agent.mjs")
})
