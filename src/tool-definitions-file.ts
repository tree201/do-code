import { mkdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ToolImplementation } from "./tool-contracts.js"
import { stringArray, toolSchema } from "./tool-definition-helpers.js"
import { MAX_BATCH_FILES, discoverToolFiles, readToolTextFile, rgExcludes } from "./tool-files.js"
import { MAX_TOOL_OUTPUT, optionalBoolean, optionalNumber, optionalText, resolveToolPath, text, truncateToolOutput } from "./tool-input.js"
import { lineCount, replacementDiffLines } from "./tool-presentation.js"
import { captureCommand } from "./tool-shell.js"
import { TOOL_NAMES } from "./tool-names.js"

const DEFAULT_RESULT_LIMIT = 200
const READ_MANY_CONCURRENCY = 4

const listDirectoryTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.LIST_DIRECTORY,
    description: "List the immediate files and directories in a workspace directory. Respects project ignores.",
    parameters: toolSchema({ path: { type: "string", description: "Workspace-relative directory; use . for the root" }, limit: { type: "integer", minimum: 1, maximum: 1000 } }, ["path"]),
  } },
  async execute(args, context) {
    const requested = text(args, "path")
    const limit = Math.min(optionalNumber(args, "limit") ?? DEFAULT_RESULT_LIMIT, 1000)
    const files = await discoverToolFiles(context, requested)
    const entries = new Set<string>()
    for (const file of files) {
      const [head, ...rest] = file.split("/")
      if (head) entries.add(rest.length > 0 ? `${head}/` : head)
    }
    const sorted = [...entries].sort((a, b) => a.localeCompare(b))
    const suffix = sorted.length > limit ? `\n... ${sorted.length - limit} more entries` : ""
    return { ok: true, output: sorted.slice(0, limit).join("\n") + suffix || "(empty directory)" }
  },
}

const globTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.GLOB,
    description: "Find workspace files matching a glob pattern. Respects .gitignore and default generated-directory exclusions.",
    parameters: toolSchema({ pattern: { type: "string", description: "Glob such as **/*.ts" }, path: { type: "string", description: "Workspace-relative directory; defaults to ." }, limit: { type: "integer", minimum: 1, maximum: 1000 } }, ["pattern"]),
  } },
  async execute(args, context) {
    const requested = optionalText(args, "path") ?? "."
    const limit = Math.min(optionalNumber(args, "limit") ?? DEFAULT_RESULT_LIMIT, 1000)
    const files = await discoverToolFiles(context, requested, text(args, "pattern"))
    const prefixed = files.map((file) => requested === "." ? file : path.join(requested, file))
    const suffix = prefixed.length > limit ? `\n... ${prefixed.length - limit} more files` : ""
    return { ok: true, output: prefixed.slice(0, limit).join("\n") + suffix || "(no files)" }
  },
}

const readFileTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.READ_FILE,
    description: "Read a UTF-8 text file with optional zero-based line offset and line limit.",
    parameters: toolSchema({ path: { type: "string" }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1 } }, ["path"]),
  } },
  async execute(args, context) {
    const requested = text(args, "path")
    const lines = (await readToolTextFile(context, requested)).split(/\r?\n/)
    const offset = optionalNumber(args, "offset") ?? 0
    const limit = optionalNumber(args, "limit") ?? 400
    return { ok: true, output: truncateToolOutput(lines.slice(offset, offset + limit).map((line, index) => `${offset + index + 1}: ${line}`).join("\n")) }
  },
}

const readManyFilesTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.READ_MANY_FILES,
    description: "Read and concatenate up to 20 UTF-8 workspace files selected by exact paths or glob patterns.",
    parameters: toolSchema({ include: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_BATCH_FILES }, exclude: { type: "array", items: { type: "string" } } }, ["include"]),
  } },
  async execute(args, context) {
    const include = stringArray(args, "include")
    if (include.length === 0) return { ok: false, output: "include must not be empty" }
    if (include.length > MAX_BATCH_FILES) return { ok: false, output: `Too many include patterns (limit ${MAX_BATCH_FILES})` }
    const exclude = typeof args === "object" && args !== null && (args as Record<string, unknown>).exclude !== undefined ? stringArray(args, "exclude") : []
    const selected = new Set<string>()
    for (const item of include) {
      const target = resolveToolPath(context, item)
      try {
        const info = await stat(target)
        if (info.isFile()) selected.add(item)
        else if (info.isDirectory()) for (const file of await discoverToolFiles(context, item)) selected.add(path.join(item, file))
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== "ENOENT" && !/[?*\[]/.test(item)) throw error
        for (const file of await discoverToolFiles(context, ".", item)) selected.add(file)
      }
    }
    let files = [...selected].sort((a, b) => a.localeCompare(b))
    if (exclude.length > 0) {
      const excluded = new Set<string>()
      for (const pattern of exclude) for (const file of await discoverToolFiles(context, ".", pattern)) excluded.add(file)
      files = files.filter((file) => !excluded.has(file))
    }
    const overflow = files.length - MAX_BATCH_FILES
    files = files.slice(0, MAX_BATCH_FILES)
    const results = new Array<{ section?: string; skipped?: string }>(files.length)
    let nextFile = 0
    await Promise.all(Array.from({ length: Math.min(READ_MANY_CONCURRENCY, files.length) }, async () => {
      while (nextFile < files.length) {
        const index = nextFile++
        const file = files[index]!
        try { results[index] = { section: `--- ${file} ---\n${await readToolTextFile(context, file)}` } }
        catch (error) { results[index] = { skipped: `${file}: ${error instanceof Error ? error.message : String(error)}` } }
      }
    }))
    const sections = results.flatMap((result) => result.section ? [result.section] : [])
    const skipped: string[] = []
    for (const result of results) if (result.skipped) skipped.push(result.skipped)
    if (overflow > 0) skipped.push(`${overflow} additional matching file(s): batch limit reached`)
    if (skipped.length > 0) sections.push(`--- skipped ---\n${skipped.join("\n")}`)
    return { ok: true, output: truncateToolOutput(sections.join("\n\n") || "(no readable files)") }
  },
}

const searchTool: ToolImplementation = {
  definition: { type: "function", function: {
    name: TOOL_NAMES.SEARCH,
    description: "Search text in workspace files using ripgrep.",
    parameters: toolSchema({ query: { type: "string" }, path: { type: "string", description: "Workspace-relative file or directory" }, glob: { type: "string", description: "Optional file glob such as *.ts" }, context: { type: "integer", minimum: 0, maximum: 20 }, max_results: { type: "integer", minimum: 1, maximum: 1000 }, fixed_strings: { type: "boolean", description: "Treat query literally instead of as a regular expression" } }, ["query", "path"]),
  } },
  async execute(args, context) {
    const query = text(args, "query")
    const target = resolveToolPath(context, text(args, "path"))
    const limit = Math.min(optionalNumber(args, "max_results") ?? DEFAULT_RESULT_LIMIT, 1000)
    const searchArgs = ["-n", "--color", "never", "--no-heading", "--hidden", ...rgExcludes()]
    try {
      const gitIgnore = path.join(context.workspace, ".gitignore")
      if ((await stat(gitIgnore)).isFile()) searchArgs.push("--ignore-file", gitIgnore)
    } catch { /* A workspace does not need a .gitignore file. */ }
    if (optionalBoolean(args, "fixed_strings")) searchArgs.push("-F")
    const surrounding = Math.min(optionalNumber(args, "context") ?? 0, 20)
    if (surrounding > 0) searchArgs.push("-C", String(surrounding))
    const fileGlob = optionalText(args, "glob")
    if (fileGlob) searchArgs.push("--glob", fileGlob)
    searchArgs.push("--", query, target)
    const captureLimit = Math.min(MAX_TOOL_OUTPUT, Math.max(8_000, limit * 1_000))
    const result = await captureCommand("rg", searchArgs, context.workspace, 120_000, captureLimit)
    if (result.error) return { ok: false, output: result.error }
    if (result.code === 1) return { ok: true, output: "(no matches)" }
    if (result.code !== 0 && !result.truncated) return { ok: false, output: result.stderr.trim() || `ripgrep exited with code ${result.code}` }
    const lines = result.stdout.trimEnd().split(/\r?\n/)
    const suffix = result.truncated ? "\n... additional result lines omitted" : lines.length > limit ? `\n... ${lines.length - limit} more result lines` : ""
    return { ok: true, output: truncateToolOutput(lines.slice(0, limit).join("\n") + suffix) }
  },
}

const writeFileTool: ToolImplementation = {
  definition: { type: "function", function: { name: TOOL_NAMES.WRITE_FILE, description: "Create or completely replace a UTF-8 file inside the workspace.", parameters: toolSchema({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]) } },
  async execute(args, context) {
    const requested = text(args, "path")
    const target = resolveToolPath(context, requested)
    const content = text(args, "content")
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, "utf8")
    return { ok: true, output: `Wrote ${requested}`, presentation: { kind: "edit", targets: [requested], fileChanges: [{ path: requested, additions: lineCount(content), deletions: 0, lines: lineCount(content), diffLines: replacementDiffLines("", content, 1) }] } }
  },
}

const editFileTool: ToolImplementation = {
  definition: { type: "function", function: { name: TOOL_NAMES.EDIT_FILE, description: "Replace one exact, unique text block in a UTF-8 file.", parameters: toolSchema({ path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, ["path", "old_text", "new_text"]) } },
  async execute(args, context) {
    const requested = text(args, "path")
    const target = resolveToolPath(context, requested)
    const oldText = text(args, "old_text")
    if (!oldText) return { ok: false, output: "old_text must not be empty" }
    const content = await readToolTextFile(context, requested)
    const first = content.indexOf(oldText)
    if (first < 0) return { ok: false, output: "old_text was not found" }
    if (content.indexOf(oldText, first + oldText.length) >= 0) return { ok: false, output: "old_text is not unique" }
    const newText = text(args, "new_text")
    const startLine = content.slice(0, first).split(/\r?\n/).length
    await writeFile(target, content.slice(0, first) + newText + content.slice(first + oldText.length), "utf8")
    return { ok: true, output: `Edited ${requested}`, presentation: { kind: "edit", targets: [requested], fileChanges: [{ path: requested, additions: lineCount(newText), deletions: lineCount(oldText), diffLines: replacementDiffLines(oldText, newText, startLine) }] } }
  },
}

export const fileTools = [listDirectoryTool, globTool, readFileTool, readManyFilesTool, searchTool, writeFileTool, editFileTool] satisfies ToolImplementation[]
