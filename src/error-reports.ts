import { randomBytes } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import type { DoCodeLanguage } from "./config.js"
import { projectDataPath, userDataRoot } from "./sessions.js"
import { t } from "./ui/i18n.js"
import { DO_CODE_VERSION } from "./version.js"

const run = promisify(execFile)
const MAX_CONTEXT_BYTES = 300_000

export type ErrorReport = {
  schemaVersion: 1
  id: string
  createdAt: string
  category: "exception" | "bad_case"
  message: string
  stack: string | null
  workspace: string
  sessionId: string | null
  model: string | null
  operation: string
  runtime: { doCodeVersion: string; node: string; platform: string; arch: string; pid: number }
  git: { revision: string | null; status: string | null; diff: string | null }
  context: unknown
  file: string
}

export function errorReportsRoot() {
  return process.env.DO_CODE_ERROR_DIR ?? path.join(userDataRoot(), "errors")
}

function legacyErrorReportsRoot(workspace: string) {
  return projectDataPath(workspace, "errors")
}

function errorId(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "")
  return `err_${date}_${randomBytes(4).toString("hex")}`
}

function redactText(value: string) {
  let output = value
  const secrets = Object.entries(process.env)
    .filter(([key, secret]) => secret && /(api.?key|token|secret|password)/i.test(key) && secret.length >= 6)
    .map(([, secret]) => secret!)
  for (const secret of secrets) output = output.replaceAll(secret, "[REDACTED]")
  return output
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,"']+/gi, "$1[REDACTED]")
}

function safeContext(context: unknown) {
  const serialized = redactText(JSON.stringify(context ?? null, null, 2))
  if (Buffer.byteLength(serialized) <= MAX_CONTEXT_BYTES) return JSON.parse(serialized) as unknown
  return { truncatedText: Buffer.from(serialized).subarray(0, MAX_CONTEXT_BYTES).toString("utf8"), truncated: true }
}

async function git(workspace: string, args: string[]) {
  return (await run("git", args, { cwd: workspace, maxBuffer: 2_000_000 }).then((result) => result.stdout.trim()).catch(() => "")) || null
}

export async function reportError(input: {
  error: unknown
  workspace: string
  operation: string
  category?: ErrorReport["category"]
  sessionId?: string
  model?: string
  context?: unknown
}) {
  const value = input.error instanceof Error ? input.error : new Error(String(input.error))
  const id = errorId()
  const [revision, status, diff] = await Promise.all([
    git(input.workspace, ["rev-parse", "HEAD"]), git(input.workspace, ["status", "--short"]),
    git(input.workspace, ["diff", "--binary", "--no-ext-diff", "--", "."]),
  ])
  const base = {
    schemaVersion: 1 as const, id, createdAt: new Date().toISOString(), category: input.category ?? "exception",
    message: redactText(value.message), stack: value.stack ? redactText(value.stack) : null,
    workspace: input.workspace, sessionId: input.sessionId ?? null, model: input.model ?? null, operation: input.operation,
    runtime: { doCodeVersion: DO_CODE_VERSION, node: process.version, platform: process.platform, arch: process.arch, pid: process.pid },
    git: { revision, status: status ? redactText(status) : null, diff: diff ? redactText(diff).slice(0, 500_000) : null },
    context: safeContext(input.context),
  }
  const file = path.join(errorReportsRoot(), `${id}.json`)
  try {
    await mkdir(path.dirname(file), { recursive: true })
    const report: ErrorReport = { ...base, file }
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    return report
  } catch {
    return { ...base, file: "" } satisfies ErrorReport
  }
}

async function readErrorReport(root: string, id: string) {
  const value = await readFile(path.join(root, `${id}.json`), "utf8").catch(() => null)
  return value ? JSON.parse(value) as ErrorReport : null
}

async function reportsIn(root: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const reports = await Promise.all(entries.filter((entry) => entry.isFile() && /^err_.*\.json$/.test(entry.name)).map(async (entry) => {
    try { return JSON.parse(await readFile(path.join(root, entry.name), "utf8")) as ErrorReport } catch { return null }
  }))
  return reports.filter((item): item is ErrorReport => Boolean(item))
}

async function legacyReportRoots() {
  const projectsRoot = path.join(userDataRoot(), "projects")
  const entries = await readdir(projectsRoot, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(projectsRoot, entry.name, "errors"))
}

export async function loadErrorReport(id: string, workspace = process.cwd()) {
  if (!/^err_\d{8}_[a-f0-9]{8}$/.test(id)) throw new Error(`Invalid error ID: ${id}`)
  const global = await readErrorReport(errorReportsRoot(), id)
  if (global) return global
  const local = await readErrorReport(legacyErrorReportsRoot(workspace), id)
  if (local) return local
  for (const root of await legacyReportRoots()) {
    const report = await readErrorReport(root, id)
    if (report) return report
  }
  throw new Error(`Error report not found: ${id}`)
}

export async function listErrorReports(limit = 20, today = false) {
  const reports = [...await reportsIn(errorReportsRoot()), ...(await Promise.all((await legacyReportRoots()).map(reportsIn))).flat()]
  const date = new Date().toISOString().slice(0, 10)
  return [...new Map(reports.map((report) => [report.id, report])).values()]
    .filter((report) => !today || report.createdAt.startsWith(date))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

export function formatErrorReport(report: ErrorReport, language: DoCodeLanguage = "en") {
  return [
    `${t(language, "Error ID")}: ${report.id}`, `${t(language, "Category")}: ${report.category}`, `${t(language, "Time")}: ${report.createdAt}`, `${t(language, "Operation")}: ${report.operation}`,
    `${t(language, "Error")}: ${report.message}`, `${t(language, "Workspace")}: ${report.workspace}`, `${t(language, "Session")}: ${report.sessionId ?? "—"}`, `${t(language, "Model")}: ${report.model ?? "—"}`,
    `${t(language, "Git Revision")}: ${report.git.revision ?? "—"}`, `${t(language, "Log file")}: ${report.file}`, "", `${t(language, "Stack")}:`, report.stack ?? "—",
    "", `${t(language, "Git Status")}:`, report.git.status ?? "—", "", `${t(language, "Git Diff")}:`, report.git.diff ?? "—", "", `${t(language, "Reproduction context")}:`, JSON.stringify(report.context, null, 2),
  ].join("\n")
}
