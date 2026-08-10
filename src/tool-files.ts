import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import type { ToolContext } from "./tool-contracts.js"
import { captureCommand } from "./tool-shell.js"
import { resolveToolPath } from "./tool-input.js"

export const MAX_FILE_BYTES = 200_000
export const MAX_BATCH_FILES = 20
export const DEFAULT_EXCLUDES = ["!.git/**", "!.do-code/**", "!**/node_modules/**", "!**/dist/**", "!**/build/**", "!**/coverage/**"]

export function rgExcludes() {
  return DEFAULT_EXCLUDES.flatMap((pattern) => ["--glob", pattern])
}

export async function discoverToolFiles(context: ToolContext, requested: string, pattern?: string) {
  const target = resolveToolPath(context, requested)
  const info = await stat(target)
  if (!info.isDirectory()) throw new Error(`Path is not a directory: ${requested}`)
  const args = ["--files", "--hidden", ...rgExcludes()]
  try {
    const gitIgnore = path.join(context.workspace, ".gitignore")
    if ((await stat(gitIgnore)).isFile()) args.push("--ignore-file", gitIgnore)
  } catch {
    // A workspace does not need a .gitignore file.
  }
  if (pattern) args.push("--glob", pattern)
  args.push(".")
  const result = await captureCommand("rg", args, target)
  if (result.error) throw new Error(result.error)
  if (result.code !== 0 && result.code !== 1) throw new Error(result.stderr.trim() || `ripgrep exited with code ${result.code}`)
  return result.stdout.split(/\r?\n/).filter(Boolean).map((entry) => entry.replace(/^\.\//, "")).sort((a, b) => a.localeCompare(b))
}

export function decodeToolText(content: Buffer, requested: string) {
  if (content.subarray(0, Math.min(content.length, 8_000)).includes(0)) throw new Error(`File appears to be binary: ${requested}`)
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content)
  } catch {
    throw new Error(`File is not valid UTF-8 text: ${requested}`)
  }
}

export async function readToolTextFile(context: ToolContext, requested: string) {
  const target = resolveToolPath(context, requested)
  const info = await stat(target)
  if (!info.isFile()) throw new Error(`Path is not a file: ${requested}`)
  if (info.size > MAX_FILE_BYTES) throw new Error(`File is too large: ${info.size} bytes (limit ${MAX_FILE_BYTES})`)
  return decodeToolText(await readFile(target), requested)
}
