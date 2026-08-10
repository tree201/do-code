import { stderr, stdout } from "node:process"
import { reportError } from "./error-reports.js"
import { EXIT_CODES, HEADLESS_PROTOCOL_VERSION, streamEnvelope } from "./headless.js"

export type CliOutputFormat = "text" | "json" | "stream-json"

export function requestedOutputFormat(argv: string[]): CliOutputFormat {
  const formatIndex = argv.indexOf("--output-format")
  const requested = formatIndex >= 0 ? argv[formatIndex + 1] : undefined
  return argv.includes("--json") || requested === "json" ? "json" : requested === "stream-json" ? "stream-json" : "text"
}

export function exitCodeForCliError(message: string) {
  if (/task|argument|requires|must be|usage|unknown/i.test(message)) return EXIT_CODES.argument
  if (/model|api key|endpoint|fetch/i.test(message)) return EXIT_CODES.model
  return EXIT_CODES.unknown
}

export async function handleCliError(error: unknown, argv = process.argv.slice(2)) {
  const message = error instanceof Error ? error.message : String(error)
  const format = requestedOutputFormat(argv)
  const exitCode = exitCodeForCliError(message)
  const report = await reportError({ error, workspace: process.cwd(), operation: "cli.main", context: { argv } })
  if (format === "stream-json") {
    stdout.write(`${JSON.stringify(streamEnvelope(`run_error_${Date.now().toString(36)}`, 0, "result", { status: "failed", stopReason: exitCode === EXIT_CODES.model ? "model_error" : "unknown_error", errorMessage: message, errorId: report.id, exitCode }))}\n`)
  } else if (format === "json") {
    stdout.write(`${JSON.stringify({ protocolVersion: HEADLESS_PROTOCOL_VERSION, status: "failed", errorMessage: message, errorId: report.id, exitCode })}\n`)
  } else stderr.write(`do-code: ${message}\nError ID: ${report.id}\nView: do-code errors show ${report.id}\n`)
  process.exitCode = exitCode
}
