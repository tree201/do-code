import { Text } from "ink"
import { render } from "@tree201/markdansi"
import { marked } from "marked"
import { tuiTheme } from "./theme.js"

export function parseMarkdownBlocks(source: string) {
  return marked.lexer(source, { gfm: true, breaks: false })
}

export function MarkdownText({ children, width, pending = false, trimBoundarySpacing = false, maxPendingCodeRows }: { children: string; width?: number; pending?: boolean; trimBoundarySpacing?: boolean; maxPendingCodeRows?: number }) {
  const source = trimBoundarySpacing ? children.trim() : children
  const rendered = render(source, {
    color: true,
    hyperlinks: false,
    inlineCodeMarkers: true,
    blockSpacing: "compact",
    unorderedListMarker: "•",
    tableLayout: "auto",
    wrap: width !== undefined,
    ...(width ? { width } : {}),
    ...(pending && maxPendingCodeRows ? { maxCodeRows: maxPendingCodeRows } : {}),
    theme: {
      heading: { bold: true },
      strong: { bold: true },
      emph: { italic: true },
      inlineCode: { color: tuiTheme.accent },
      link: { color: tuiTheme.accent, underline: true },
      quote: { dim: true },
      hr: { dim: true },
      listMarker: { color: tuiTheme.accent },
    },
  }).replace(/^\n+/, "").trimEnd()
  return <Text>{rendered}</Text>
}

export function ToolOutput({ children }: { children: string }) {
  return <Text dimColor>{children.trim()}</Text>
}
