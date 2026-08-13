import assert from "node:assert/strict"
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { errorReportsRoot, listErrorReports, loadErrorReport, reportError, type ErrorReport } from "../src/error-reports.js"
import { projectDataPath } from "../src/sessions.js"

function legacyReport(id: string, workspace: string, createdAt: string): ErrorReport {
  return {
    schemaVersion: 1,
    id,
    createdAt,
    category: "bad_case",
    message: "legacy report",
    stack: null,
    workspace,
    sessionId: null,
    model: null,
    operation: "interactive.bad_case",
    runtime: { doCodeVersion: "test", node: process.version, platform: process.platform, arch: process.arch, pid: process.pid },
    git: { revision: null, status: null, diff: null },
    context: null,
    file: "",
  }
}

test("stores reports globally, reads legacy reports, and filters today's queue", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "do-code-data-"))
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-error-workspace-"))
  const legacyWorkspace = await mkdtemp(path.join(os.tmpdir(), "do-code-legacy-workspace-"))
  const previousDataRoot = process.env.DO_CODE_DATA_DIR
  const previousErrorRoot = process.env.DO_CODE_ERROR_DIR
  const previousKey = process.env.MODEL_API_KEY
  process.env.DO_CODE_DATA_DIR = dataRoot
  delete process.env.DO_CODE_ERROR_DIR
  process.env.MODEL_API_KEY = "super-secret-key"
  try {
    const report = await reportError({ error: new Error("request used super-secret-key"), workspace, operation: "test.operation", sessionId: "session_1", model: "fake", context: { authorization: "Bearer super-secret-key" } })
    const legacyId = "err_20000101_12345678"
    const legacyRoot = projectDataPath(legacyWorkspace, "errors")
    await mkdir(legacyRoot, { recursive: true })
    await writeFile(path.join(legacyRoot, `${legacyId}.json`), `${JSON.stringify(legacyReport(legacyId, legacyWorkspace, "2000-01-01T00:00:00.000Z"))}\n`)
    await writeFile(path.join(legacyRoot, `${report.id}.json`), await readFile(report.file, "utf8"))

    assert.match(report.id, /^err_\d{8}_[a-f0-9]{8}$/)
    assert.equal(report.file, path.join(dataRoot, "errors", `${report.id}.json`))
    await access(report.file)
    await assert.rejects(() => access(projectDataPath(workspace, "errors", `${report.id}.json`)))
    assert.equal((await loadErrorReport(report.id, workspace)).operation, "test.operation")
    assert.equal((await loadErrorReport(legacyId, workspace)).workspace, legacyWorkspace)
    assert.deepEqual((await listErrorReports()).map((item) => item.id), [report.id, legacyId])
    assert.deepEqual((await listErrorReports(20, true)).map((item) => item.id), [report.id])
    assert.doesNotMatch(await readFile(path.join(errorReportsRoot(), `${report.id}.json`), "utf8"), /super-secret-key/)
  } finally {
    if (previousDataRoot === undefined) delete process.env.DO_CODE_DATA_DIR; else process.env.DO_CODE_DATA_DIR = previousDataRoot
    if (previousErrorRoot === undefined) delete process.env.DO_CODE_ERROR_DIR; else process.env.DO_CODE_ERROR_DIR = previousErrorRoot
    if (previousKey === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = previousKey
  }
})
