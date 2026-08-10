import React from "react"
import { highlight, supportsLanguage } from "cli-highlight"
import { Box, Text } from "ink"
import { marked, type Token, type Tokens } from "marked"
import { MarkdownTable } from "./markdown-table.js"
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

function ListToken({ value, contentWidth, pendingCodeRows }: { value: Tokens.List; contentWidth?: number; pendingCodeRows?: number }) {
  return <Box flexDirection="column">{value.items.map((item, index) => {
    const marker = value.ordered ? `${Number(value.start || 1) + index}.` : "•"
    return <Box key={index} paddingLeft={1}>
      <Text color={tuiTheme.accent}>{marker} </Text>
      <Box flexDirection="column" flexGrow={1}>
        {item.tokens.map((child, childIndex) => {
          if (child.type === "paragraph") return <InlineTokens key={childIndex} tokens={(child as Tokens.Paragraph).tokens} />
          if (child.type === "text") {
            const text = child as Tokens.Text
            return text.tokens ? <InlineTokens key={childIndex} tokens={text.tokens} /> : <Text key={childIndex}>{text.text}</Text>
          }
          return <BlockToken key={childIndex} token={child} {...(contentWidth ? { contentWidth: Math.max(1, contentWidth - 3) } : {})} {...(pendingCodeRows ? { pendingCodeRows } : {})} />
        })}
      </Box>
    </Box>
  })}</Box>
}

function BlockToken({ token, contentWidth, pendingCodeRows }: BlockTokenProps) {
  if (token.type === "def") return null
  if (token.type === "space") return <Box height={1} flexShrink={0} />
  if (token.type === "heading") {
    const value = token as Tokens.Heading
    return <Text bold><InlineTokens tokens={value.tokens} /></Text>
  }
  if (token.type === "paragraph") {
    const value = token as Tokens.Paragraph
    return <InlineTokens tokens={value.tokens} />
  }
  if (token.type === "code") {
    const value = token as Tokens.Code
    return <CodeBlock source={value.text} {...(value.lang ? { language: value.lang } : {})} {...(contentWidth ? { width: contentWidth } : {})} {...(pendingCodeRows ? { pendingRows: pendingCodeRows } : {})} />
  }
  if (token.type === "blockquote") {
    const value = token as Tokens.Blockquote
    return <Box flexDirection="column" borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderColor={tuiTheme.accent} paddingLeft={1}>{value.tokens.map((child, index) => <BlockToken key={index} token={child} {...(contentWidth ? { contentWidth: Math.max(1, contentWidth - 2) } : {})} {...(pendingCodeRows ? { pendingCodeRows } : {})} />)}</Box>
  }
  if (token.type === "list") {
    const value = token as Tokens.List
    return <ListToken value={value} {...(contentWidth ? { contentWidth } : {})} {...(pendingCodeRows ? { pendingCodeRows } : {})} />
  }
  if (token.type === "table") return <MarkdownTable value={token as Tokens.Table} {...(contentWidth ? { width: contentWidth } : {})} />
  if (token.type === "hr") return <Text dimColor>{"─".repeat(40)}</Text>
  if (token.type === "html") return <Text dimColor>{(token as Tokens.HTML).text}</Text>
  if (token.type === "text") {
    const value = token as Tokens.Text
    return <Text>{value.tokens ? <InlineTokens tokens={value.tokens} /> : value.text}</Text>
  }
  return <Text>{token.raw}</Text>
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
