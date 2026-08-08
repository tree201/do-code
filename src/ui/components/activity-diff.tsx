import path from "node:path"
import React from "react"
import { highlight, supportsLanguage } from "cli-highlight"
import { Box, Text } from "ink"
import type { ActivityDiffFile } from "../activity-summary.js"
import { displayWidth, truncateTerminal } from "../terminal-text.js"
import { tuiTheme } from "../theme.js"

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".c": "c",
  ".cpp": "cpp",
  ".css": "css",
  ".go": "go",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".sh": "bash",
  ".sql": "sql",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
}

const LINE_NUMBER_WIDTH = 7
const NESTED_FILE_PREFIX = "  └ "

function highlightedCode(source: string, filePath: string) {
  const language = LANGUAGE_BY_EXTENSION[path.extname(filePath).toLowerCase()]
  if (!language || !supportsLanguage(language)) return source
  try {
    return highlight(source, { language, ignoreIllegals: true })
  } catch {
    return source
  }
}

export function ActivityDiff({ file, width, language, showHeader = true }: {
  file: ActivityDiffFile
  width: number
  language: "en" | "zh"
  showHeader?: boolean
}) {
  const contentWidth = Math.max(12, width)
  const codeWidth = Math.max(1, contentWidth - LINE_NUMBER_WIDTH - 3)
  const rows = file.lines.flatMap((line, index) => {
    const previous = file.lines[index - 1]
    const currentNumber = line.kind === "remove" ? line.oldLine : line.newLine ?? line.oldLine
    const previousNumber = previous?.kind === "remove" ? previous.oldLine : previous?.newLine ?? previous?.oldLine
    const skipped = currentNumber !== undefined && previousNumber !== undefined && currentNumber > previousNumber + 1
      ? currentNumber - previousNumber - 1
      : 0
    return [...(skipped > 0 ? [{ type: "omission" as const, count: skipped }] : []), { type: "code" as const, line, index }]
  })

  return (
    <Box flexDirection="column" marginTop={showHeader ? 1 : 0} width={contentWidth}>
      {showHeader ? (
        <Text bold>
          {NESTED_FILE_PREFIX}
          {truncateTerminal(file.path, Math.max(1, contentWidth - displayWidth(NESTED_FILE_PREFIX) - displayWidth(file.stats) - 1))}
          <ActivityDiffStats file={file} />
        </Text>
      ) : null}
      {rows.map((row, rowIndex) => {
        if (row.type === "omission") {
          return (
            <Text key={`omission-${rowIndex}`} dimColor>
              {"⋮".padStart(LINE_NUMBER_WIDTH)}
            </Text>
          )
        }
        const { line, index } = row
        const lineNumber = line.kind === "remove" ? line.oldLine : line.newLine ?? line.oldLine
        const marker = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "
        const backgroundColor = line.kind === "add"
          ? tuiTheme.diffAddedBackground
          : line.kind === "remove"
            ? tuiTheme.diffRemovedBackground
            : undefined
        const markerColor = line.kind === "add"
          ? tuiTheme.diffAddedMarker
          : line.kind === "remove"
            ? tuiTheme.diffRemovedMarker
            : tuiTheme.diffLineNumber
        const number = lineNumber === undefined ? "" : String(lineNumber)
        const plainCode = truncateTerminal(line.text || " ", codeWidth, "")
        const code = highlightedCode(plainCode, file.path)
        return (
          <Box
            key={`${index}-${line.kind}-${lineNumber ?? ""}`}
            width={contentWidth}
            flexShrink={0}
            {...(backgroundColor ? { backgroundColor } : {})}
          >
            <Text>
              <Text color={tuiTheme.diffLineNumber}>{number.padStart(LINE_NUMBER_WIDTH)} </Text>
              <Text color={markerColor}>{marker} </Text>
              <Text>{code}</Text>
            </Text>
          </Box>
        )
      })}
      {file.omitted > 0 ? (
        <Text dimColor>
          {"…".padStart(LINE_NUMBER_WIDTH)}   {language === "zh" ? `… 省略 ${file.omitted} 行修改` : `… ${file.omitted} changed lines omitted`}
        </Text>
      ) : null}
    </Box>
  )
}

export function ActivityDiffStats({ file }: { file: ActivityDiffFile }) {
  if (file.additions === undefined && file.deletions === undefined) {
    return file.stats ? <Text dimColor>{file.stats}</Text> : null
  }
  return (
    <Text>
      <Text dimColor> (</Text>
      <Text color={tuiTheme.diffAddedMarker}>+{file.additions ?? 0}</Text>
      <Text dimColor> </Text>
      <Text color={tuiTheme.diffRemovedMarker}>-{file.deletions ?? 0}</Text>
      <Text dimColor>)</Text>
    </Text>
  )
}
