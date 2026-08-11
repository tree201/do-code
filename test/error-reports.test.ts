import assert from "node:assert/strict"
import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { errorReportsRoot, listErrorReports, loadErrorReport, reportError } from "../src/error-reports.js"

test("error reports are addressable by id and redact configured secrets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "do-code-errors-"))
  const workspace = await mkdtemp(path.join(os.tmpdir(), "do-code-error-workspace-"))
  const previousRoot = process.env.DO_CODE_ERROR_DIR
  const previousKey = process.env.MODEL_API_KEY
  process.env.DO_CODE_ERROR_DIR = root
  process.env.MODEL_API_KEY = "super-secret-key"
  try {
    const report = await reportError({ error: new Error("request used super-secret-key"), workspace, operation: "test.operation", sessionId: "session_1", model: "fake", context: { authorization: "Bearer super-secret-key" } })
    assert.match(report.id, /^err_\d{8}_[a-f0-9]{8}$/)
    assert.equal((await loadErrorReport(report.id, workspace)).operation, "test.operation")
    assert.equal((await listErrorReports(workspace))[0]?.id, report.id)
    assert.doesNotMatch(await readFile(path.join(errorReportsRoot(workspace), `${report.id}.json`), "utf8"), /super-secret-key/)
  } finally {
    if (previousRoot === undefined) delete process.env.DO_CODE_ERROR_DIR; else process.env.DO_CODE_ERROR_DIR = previousRoot
    if (previousKey === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = previousKey
  }
})
