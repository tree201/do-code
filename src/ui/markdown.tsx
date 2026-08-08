import React from "react"
import { highlight, supportsLanguage } from "cli-highlight"
import { Box, Text } from "ink"
import { marked, type Token, type Tokens } from "marked"
import { displayWidth, padTerminalEnd } from "./terminal-text.js"
import { tuiTheme } from "./theme.js"

export function parseMarkdownBlocks(source: string) {
  return marked.lexer(source, { gfm: true, breaks: false })
}

function InlineTokens({ tokens }: { tokens: Token[] }) {
  return (
    <Text>
      {tokens.map((token, index) => {
        const key = `${token.type}-${index}`
        if (token.type === "strong") {
          const value = token as Tokens.Strong
          return <Text key={key} bold><InlineTokens tokens={value.tokens} /></Text>
        }
        if (token.type === "em") {
          const value = token as Tokens.Em
          return <Text key={key} italic><InlineTokens tokens={value.tokens} /></Text>
        }
        if (token.type === "del") {
          const value = token as Tokens.Del
          return <Text key={key} strikethrough><InlineTokens tokens={value.tokens} /></Text>
        }
        if (token.type === "codespan") return <Text key={key} color={tuiTheme.accent}>`{(token as Tokens.Codespan).text}`</Text>
        if (token.type === "link") {
          const value = token as Tokens.Link
          return <Text key={key} color={tuiTheme.accent} underline><InlineTokens tokens={value.tokens} /></Text>
        }
        if (token.type === "image") return <Text key={key} color={tuiTheme.accent}>[Image: {(token as Tokens.Image).text}]</Text>
        if (token.type === "br") return <Text key={key}>{"\n"}</Text>
        if (token.type === "escape") return <Text key={key}>{(token as Tokens.Escape).text}</Text>
        if (token.type === "text") {
          const value = token as Tokens.Text
          return value.tokens?.length ? <InlineTokens key={key} tokens={value.tokens} /> : <Text key={key}>{value.text}</Text>
        }
        return <Text key={key}>{"text" in token && typeof token.text === "string" ? token.text : token.raw}</Text>
      })}
    </Text>
  )
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

function CodeBlock({ source, language, width }: { source: string; language?: string; width?: number }) {
  const normalizedLanguage = language?.split(/\s+/)[0]?.toLowerCase()
  if (normalizedLanguage === "diff" || normalizedLanguage === "patch") return <DiffBlock source={source} {...(width ? { width } : {})} />
  let rendered = source
  try {
    rendered = highlight(source, {
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
    </Box>
  )
}

function BlockToken({ token, contentWidth }: { token: Token; contentWidth?: number }) {
  if (token.type === "space" || token.type === "def") return null
  if (token.type === "heading") {
    const value = token as Tokens.Heading
    return <Box marginTop={value.depth > 2 ? 0 : 1}><Text bold><InlineTokens tokens={value.tokens} /></Text></Box>
  }
  if (token.type === "paragraph") {
    const value = token as Tokens.Paragraph
    return <Box marginBottom={1}><InlineTokens tokens={value.tokens} /></Box>
  }
  if (token.type === "code") {
    const value = token as Tokens.Code
    return <Box marginBottom={1}><CodeBlock source={value.text} {...(value.lang ? { language: value.lang } : {})} {...(contentWidth ? { width: contentWidth } : {})} /></Box>
  }
  if (token.type === "blockquote") {
    const value = token as Tokens.Blockquote
    return <Box flexDirection="column" borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderColor={tuiTheme.accent} paddingLeft={1} marginBottom={1}>{value.tokens.map((child, index) => <BlockToken key={index} token={child} {...(contentWidth ? { contentWidth: Math.max(1, contentWidth - 2) } : {})} />)}</Box>
  }
  if (token.type === "list") {
    const value = token as Tokens.List
    return (
      <Box flexDirection="column" marginBottom={1}>
        {value.items.map((item, index) => (
          <Box key={index} paddingLeft={1}>
            <Text color={tuiTheme.accent}>{value.ordered ? `${Number(value.start || 1) + index}.` : "•"} </Text>
            <InlineTokens tokens={item.tokens} />
          </Box>
        ))}
      </Box>
    )
  }
  if (token.type === "table") {
    const value = token as Tokens.Table
    const rows = [value.header, ...value.rows].map((row) => row.map((cell) => cell.text))
    const columnWidths = value.header.map((_, column) => Math.max(3, ...rows.map((row) => displayWidth(row[column] ?? ""))))
    const rowText = (row: string[]) => row.map((cell, column) => padTerminalEnd(cell, columnWidths[column] ?? 3)).join(" │ ")
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={tuiTheme.border} paddingX={1} marginBottom={1} {...(contentWidth ? { width: contentWidth } : {})}>
        <Text bold wrap="truncate-end">{rowText(rows[0] ?? [])}</Text>
        <Text dimColor wrap="truncate-end">{columnWidths.map((cellWidth) => "─".repeat(cellWidth)).join("─┼─")}</Text>
        {rows.slice(1).map((row, index) => <Text key={index} wrap="truncate-end">{rowText(row)}</Text>)}
      </Box>
    )
  }
  if (token.type === "hr") return <Text dimColor>{"─".repeat(40)}</Text>
  if (token.type === "html") return <Text dimColor>{(token as Tokens.HTML).text}</Text>
  if (token.type === "text") {
    const value = token as Tokens.Text
    return <Text>{value.tokens ? <InlineTokens tokens={value.tokens} /> : value.text}</Text>
  }
  return <Text>{token.raw}</Text>
}

export function MarkdownText({ children, width }: { children: string; width?: number }) {
  const tokens = parseMarkdownBlocks(children)
  return <Box flexDirection="column" {...(width ? { width } : {})}>{tokens.map((token, index) => <BlockToken key={index} token={token} {...(width ? { contentWidth: width } : {})} />)}</Box>
}

export function ToolOutput({ children }: { children: string }) {
  const trimmed = children.trim()
  if (/^(diff --git |--- |@@ )/m.test(trimmed)) return <DiffBlock source={trimmed} />
  return <Text dimColor>{trimmed}</Text>
}
