import React from "react"
import { highlight, supportsLanguage } from "cli-highlight"
import { Box, Text } from "ink"
import { render } from "markdansi"
import { marked, type Token, type Tokens } from "marked"
import { MarkdownTable } from "./markdown-table.js"
import { tuiTheme } from "./theme.js"

export function parseMarkdownBlocks(source: string) {
  return marked.lexer(source, { gfm: true, breaks: false })
}

function renderAnsiMarkdown(source: string, width?: number, compactList = false) {
  const imagePlaceholders = source.replace(/!\[([^\]]*)\]\([^)]*\)/g, "[Image: $1]")
  const rendered = render(imagePlaceholders, {
    color: true,
    hyperlinks: false,
    inlineCodeMarkers: true,
    wrap: width !== undefined,
    ...(width ? { width } : {}),
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
  if (!compactList) return rendered
  return rendered
    .replace(/(^|\n)(\s*)\x1b\[36m-\x1b\[39m /g, "$1$2\x1b[36m•\x1b[39m ")
    .replace(/\n{2,}/g, "\n")
}

function DiffBlock({ source, width }: { source: string; width?: number }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={tuiTheme.border} paddingX={1} {...(width ? { width } : {})}>
      <Text dimColor>diff</Text>
      {source.split("\n").map((line, index) => {
        const added = line.startsWith("+") && !line.startsWith("+++")
        const removed = line.startsWith("-") && !line.startsWith("---")
        const header = line.startsWith("@@") || line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---")
        const color = added ? tuiTheme.success : removed ? tuiTheme.danger : header ? tuiTheme.accent : null
        return color ? <Text key={index} color={color}>{line || " "}</Text> : <Text key={index}>{line || " "}</Text>
      })}
    </Box>
  )
}

function CodeBlock({ source, language, width, pendingRows }: { source: string; language?: string; width?: number; pendingRows?: number }) {
  const normalizedLanguage = language?.split(/\s+/)[0]?.toLowerCase()
  if (normalizedLanguage === "diff" || normalizedLanguage === "patch") return <DiffBlock source={source} {...(width ? { width } : {})} />
  const sourceLines = source.split("\n")
  const truncated = pendingRows !== undefined && sourceLines.length > pendingRows
  const visibleSource = truncated ? sourceLines.slice(0, pendingRows).join("\n") : source
  let rendered = visibleSource
  try {
    rendered = highlight(visibleSource, {
      ...(normalizedLanguage && supportsLanguage(normalizedLanguage) ? { language: normalizedLanguage } : {}),
      ignoreIllegals: true,
    })
  } catch {
    rendered = source
  }
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={tuiTheme.border} paddingX={1} {...(width ? { width } : {})}>
      {normalizedLanguage ? <Text dimColor>{normalizedLanguage}</Text> : null}
      <Text>{rendered}</Text>
      {truncated ? <Text dimColor>… code is being written …</Text> : null}
    </Box>
  )
}

type BlockTokenProps = { token: Token; contentWidth?: number; pendingCodeRows?: number }

function BlockToken({ token, contentWidth, pendingCodeRows }: BlockTokenProps) {
  if (token.type === "def") return null
  if (token.type === "space") return <Box height={1} flexShrink={0} />
  if (token.type === "code") {
    const value = token as Tokens.Code
    return <CodeBlock source={value.text} {...(value.lang ? { language: value.lang } : {})} {...(contentWidth ? { width: contentWidth } : {})} {...(pendingCodeRows ? { pendingRows: pendingCodeRows } : {})} />
  }
  if (token.type === "table") return <MarkdownTable value={token as Tokens.Table} {...(contentWidth ? { width: contentWidth } : {})} />
  if (token.type === "html") return <Text dimColor>{(token as Tokens.HTML).text}</Text>
  return <Text>{renderAnsiMarkdown(token.raw, contentWidth, token.type === "list")}</Text>
}

function hasOpenFinalFence(tokens: Token[]) {
  const last = tokens.at(-1)
  if (last?.type !== "code") return false
  const opener = /^ {0,3}(`{3,}|~{3,})/.exec(last.raw)?.[1]
  return Boolean(opener && !new RegExp(`\\n {0,3}${opener[0]}{${opener.length},}\\s*\\n?$`).test(last.raw))
}

export function MarkdownText({ children, width, pending = false, trimBoundarySpacing = false, maxPendingCodeRows }: { children: string; width?: number; pending?: boolean; trimBoundarySpacing?: boolean; maxPendingCodeRows?: number }) {
  const parsed = parseMarkdownBlocks(children)
  const tokens = trimBoundarySpacing
    ? parsed.slice(parsed[0]?.type === "space" ? 1 : 0, parsed.at(-1)?.type === "space" ? -1 : undefined)
    : parsed
  const pendingCode = pending && hasOpenFinalFence(tokens) ? maxPendingCodeRows : undefined
  return <Box flexDirection="column" {...(width ? { width } : {})}>{tokens.map((token, index) => <BlockToken key={index} token={token} {...(width ? { contentWidth: width } : {})} {...(token === tokens.at(-1) && pendingCode ? { pendingCodeRows: pendingCode } : {})} />)}</Box>
}

export function ToolOutput({ children }: { children: string }) {
  const trimmed = children.trim()
  if (/^(diff --git |--- |@@ )/m.test(trimmed)) return <DiffBlock source={trimmed} />
  return <Text dimColor>{trimmed}</Text>
}
