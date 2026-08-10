import React from "react"
import { Box, Text } from "ink"
import { type Token, type Tokens } from "marked"
import { displayWidth } from "./terminal-text.js"
import { tuiTheme } from "./theme.js"

type TableStyle = {
  bold?: boolean
  color?: string
  italic?: boolean
  strikethrough?: boolean
  underline?: boolean
}

type StyledTableSegment = TableStyle & { text: string }
type StyledTableLine = StyledTableSegment[]
type TableCell = { text: string; tokens?: Token[] }

const MIN_COLUMN_WIDTH = 3
const MAX_ROW_LINES = 4
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function sameStyle(left: TableStyle, right: TableStyle) {
  return left.bold === right.bold
    && left.color === right.color
    && left.italic === right.italic
    && left.strikethrough === right.strikethrough
    && left.underline === right.underline
}

function appendSegment(segments: StyledTableSegment[], segment: StyledTableSegment) {
  if (!segment.text) return
  const previous = segments.at(-1)
  if (previous && sameStyle(previous, segment)) previous.text += segment.text
  else segments.push(segment)
}

function cellSegments(tokens: Token[], style: TableStyle = {}): StyledTableSegment[] {
  const segments: StyledTableSegment[] = []
  for (const token of tokens) {
    if (token.type === "strong") {
      for (const segment of cellSegments((token as Tokens.Strong).tokens, { ...style, bold: true })) appendSegment(segments, segment)
      continue
    }
    if (token.type === "em") {
      for (const segment of cellSegments((token as Tokens.Em).tokens, { ...style, italic: true })) appendSegment(segments, segment)
      continue
    }
    if (token.type === "del") {
      for (const segment of cellSegments((token as Tokens.Del).tokens, { ...style, strikethrough: true })) appendSegment(segments, segment)
      continue
    }
    if (token.type === "codespan") {
      appendSegment(segments, { ...style, color: tuiTheme.accent, text: (token as Tokens.Codespan).text })
      continue
    }
    if (token.type === "link") {
      for (const segment of cellSegments((token as Tokens.Link).tokens, { ...style, color: tuiTheme.accent, underline: true })) appendSegment(segments, segment)
      continue
    }
    if (token.type === "image") {
      appendSegment(segments, { ...style, color: tuiTheme.accent, text: `[Image: ${(token as Tokens.Image).text}]` })
      continue
    }
    if (token.type === "br") {
      appendSegment(segments, { ...style, text: "\n" })
      continue
    }
    if (token.type === "escape") {
      appendSegment(segments, { ...style, text: (token as Tokens.Escape).text })
      continue
    }
    if (token.type === "text") {
      const value = token as Tokens.Text
      if (value.tokens) {
        for (const segment of cellSegments(value.tokens, style)) appendSegment(segments, segment)
      } else appendSegment(segments, { ...style, text: value.text })
      continue
    }
    appendSegment(segments, { ...style, text: "text" in token && typeof token.text === "string" ? token.text : token.raw })
  }
  return segments
}

function text(segments: StyledTableSegment[]) {
  return segments.map((segment) => segment.text).join("")
}

function wrapSegments(segments: StyledTableSegment[], width: number): StyledTableLine[] {
  const lines: StyledTableLine[] = []
  let line: StyledTableLine = []
  let lineWidth = 0
  const pushLine = () => {
    lines.push(line)
    line = []
    lineWidth = 0
  }
  for (const segment of segments) {
    const sourceLines = segment.text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")
    sourceLines.forEach((sourceLine, index) => {
      for (const { segment: grapheme } of SEGMENTER.segment(sourceLine)) {
        const graphemeWidth = displayWidth(grapheme)
        if (line.length && lineWidth + graphemeWidth > Math.max(1, width)) pushLine()
        appendSegment(line, { ...segment, text: grapheme })
        lineWidth += graphemeWidth
      }
      if (index < sourceLines.length - 1) pushLine()
    })
  }
  if (line.length || !lines.length) lines.push(line)
  return lines
}

function StyledText({ segments }: { segments: StyledTableLine }) {
  return <Text>{segments.map((segment, index) => <Text key={index} {...(segment.bold ? { bold: true } : {})} {...(segment.color ? { color: segment.color } : {})} {...(segment.italic ? { italic: true } : {})} {...(segment.strikethrough ? { strikethrough: true } : {})} {...(segment.underline ? { underline: true } : {})}>{segment.text}</Text>)}</Text>
}

function CellLine({ segments, width, align }: { segments: StyledTableLine; width: number; align?: "center" | "left" | "right" | null | undefined }) {
  const padding = Math.max(0, width - displayWidth(text(segments)))
  const before = align === "right" ? padding : align === "center" ? Math.floor(padding / 2) : 0
  return <Box width={width} flexShrink={0}><Text>{" ".repeat(before)}</Text><StyledText segments={segments} /><Text>{" ".repeat(padding - before)}</Text></Box>
}

function border(widths: number[], left: string, join: string, right: string) {
  return `${left}${widths.map((width) => "─".repeat(width + 2)).join(join)}${right}`
}

export function MarkdownTable({ value, width = 80 }: { value: Tokens.Table; width?: number }) {
  const rows = [[...value.header], ...value.rows] as TableCell[][]
  const cells = rows.map((row) => row.map((cell) => cellSegments(cell.tokens ?? [{ type: "text", raw: cell.text, text: cell.text } as Tokens.Text])))
  const columnCount = Math.max(1, value.header.length)
  const viewport = Math.max(1, width)
  const available = Math.max(0, viewport - 2 - (columnCount - 1) * 3)
  const naturalWidths = Array.from({ length: columnCount }, (_, column) => Math.max(MIN_COLUMN_WIDTH, ...cells.map((row) => displayWidth(text(row[column] ?? [])))))
  const columnWidths = naturalWidths.map(() => MIN_COLUMN_WIDTH)
  let remaining = Math.max(0, available - columnWidths.reduce((sum, columnWidth) => sum + columnWidth, 0))
  while (remaining > 0) {
    const column = columnWidths.map((columnWidth, index) => ({ index, growth: (naturalWidths[index] ?? columnWidth) - columnWidth })).sort((left, right) => right.growth - left.growth)[0]
    if (!column || column.growth <= 0) break
    columnWidths[column.index] = (columnWidths[column.index] ?? MIN_COLUMN_WIDTH) + 1
    remaining--
  }
  const wrappedRows = cells.map((row) => row.map((cell, column) => wrapSegments(cell, columnWidths[column] ?? MIN_COLUMN_WIDTH)))
  const rowHeights = wrappedRows.map((row) => Math.max(1, ...row.map((cell) => cell.length)))
  const tooNarrow = available < columnCount * MIN_COLUMN_WIDTH || rowHeights.some((height, index) => index > 0 && height > MAX_ROW_LINES)
  const alignments = ((value as Tokens.Table & { align?: Array<"center" | "left" | "right" | null> }).align ?? [])
  if (tooNarrow) return <Box flexDirection="column" width={viewport}>
    {cells.slice(1).flatMap((row, rowIndex) => [
      ...(rowIndex ? [<Text key={`separator-${rowIndex}`} dimColor>{"─".repeat(viewport)}</Text>] : []),
      ...row.map((cell, column) => <Box key={`${rowIndex}-${column}`} flexDirection="column"><Text bold>{text(cells[0]?.[column] ?? [])}:</Text>{wrapSegments(cell, Math.max(1, viewport - 2)).map((line, lineIndex) => <Box key={lineIndex} paddingLeft={1}><StyledText segments={line} /></Box>)}</Box>),
    ])}
  </Box>
  const renderRow = (row: StyledTableLine[][], rowIndex: number) => Array.from({ length: rowHeights[rowIndex] ?? 1 }, (_, lineIndex) => <Box key={`row-${rowIndex}-${lineIndex}`}><Text>│ </Text>{row.map((cell, column) => <React.Fragment key={column}><CellLine segments={cell[lineIndex] ?? []} width={columnWidths[column] ?? MIN_COLUMN_WIDTH} align={alignments[column]} /><Text> │ </Text></React.Fragment>)}</Box>)
  return <Box flexDirection="column" width={viewport}>
    <Text>{border(columnWidths, "┌", "┬", "┐")}</Text>
    {renderRow(wrappedRows[0] ?? [], 0)}
    <Text>{border(columnWidths, "├", "┼", "┤")}</Text>
    {wrappedRows.slice(1).flatMap((row, index) => renderRow(row, index + 1))}
    <Text>{border(columnWidths, "└", "┴", "┘")}</Text>
  </Box>
}
