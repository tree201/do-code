import assert from "node:assert/strict"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { MarkdownText, ToolOutput, parseMarkdownBlocks } from "../src/ui/markdown.js"
import { displayWidth, padTerminalEnd, truncateTerminal, truncateTerminalStart, wrapTerminalLines } from "../src/ui/terminal-text.js"

test("terminal markdown parser recognizes common coding-agent blocks", () => {
  const tokens = parseMarkdownBlocks([
    "# 修改完成",
    "",
    "修复了 **空用户名**，涉及 `registerUser`。",
    "",
    "- 修改校验",
    "- 添加测试",
    "",
    "```ts",
    "throw new TypeError('Username is required')",
    "```",
    "",
    "```diff",
    "- return user",
    "+ return validatedUser",
    "```",
  ].join("\n"))

  assert.deepEqual(tokens.map((token) => token.type), ["heading", "space", "paragraph", "space", "list", "space", "code", "space", "code"])
  const code = tokens.filter((token) => token.type === "code")
  assert.deepEqual(code.map((token) => "lang" in token ? token.lang : undefined), ["ts", "diff"])
})

test("terminal markdown components render headings, code and diff content", () => {
  const markdown = render(React.createElement(MarkdownText, { children: "# 完成\n\n```ts\nconst ok = true\n```" })).lastFrame()
  assert.match(markdown ?? "", /完成/)
  assert.match(markdown ?? "", /const ok = true/)

  const diff = render(React.createElement(ToolOutput, { children: "diff --git a/a.ts b/a.ts\n-old\n+new" })).lastFrame()
  assert.match(diff ?? "", /-old/)
  assert.match(diff ?? "", /\+new/)
})

test("markdown lists stay compact even when source separates list items", () => {
  const frame = render(React.createElement(MarkdownText, {
    children: "### 验证结果\n1. 第一项\n   - 子项一\n   - 子项二\n\n2. 第二项\n   - 子项三",
  })).lastFrame() ?? ""
  const lines = frame.split("\n")
  assert.deepEqual(lines.filter((line) => line.trim() === ""), [])
  assert.equal(lines.findIndex((line) => line.includes("子项二")) + 1, lines.findIndex((line) => line.includes("2. 第二项")))
})

test("markdown recursively renders nested lists instead of exposing raw markers inline", () => {
  const frame = render(React.createElement(MarkdownText, {
    children: "1. Parent\n   - Child one\n   - Child two\n     1. Grandchild",
  })).lastFrame() ?? ""
  assert.match(frame, /1\. Parent/)
  assert.match(frame, /• Child one/)
  assert.match(frame, /• Child two/)
  assert.match(frame, /1\. Grandchild/)
  assert.doesNotMatch(frame, /Parent.*- Child one/)
})

test("pending code blocks stay within their dynamic row budget", () => {
  const source = `\`\`\`ts\n${Array.from({ length: 20 }, (_, index) => `line-${index}`).join("\n")}`
  const frame = render(React.createElement(MarkdownText, {
    children: source,
    pending: true,
    maxPendingCodeRows: 5,
  })).lastFrame() ?? ""
  assert.match(frame, /line-0/)
  assert.doesNotMatch(frame, /line-19/)
  assert.match(frame, /code is being written/)
  assert.ok(frame.split("\n").length <= 9)
})

test("terminal text helpers measure and truncate Chinese and emoji by display cells", () => {
  assert.equal(displayWidth("中文A"), 5)
  assert.equal(displayWidth(padTerminalEnd("中文", 6)), 6)
  assert.equal(displayWidth(truncateTerminal("中文项目名称", 7)), 7)
  assert.equal(displayWidth(truncateTerminalStart("路径/中文项目", 7)), 7)
  assert.ok(displayWidth(truncateTerminal("任务🚀完成", 6)) <= 6)
})

test("terminal line wrapping preserves Chinese and emoji without exceeding the viewport", () => {
  const lines = wrapTerminalLines("中文项目🚀ABC", 6)
  assert.ok(lines.every((line) => displayWidth(line) <= 6))
  assert.equal(lines.join(""), "中文项目🚀ABC")
})

test("markdown tables align Chinese columns by terminal width", () => {
  const frame = render(React.createElement(MarkdownText, {
    width: 40,
    children: "| 名称 | 状态 |\n| --- | --- |\n| index.html | 正常 |\n| 中文文件 | 完成 |",
  })).lastFrame() ?? ""
  const rows = frame.split("\n").filter((line) => line.includes("│"))
  assert.ok(rows.length >= 3)
  const separators = rows.map((line) => displayWidth(line.slice(0, line.indexOf("│"))))
  assert.ok(separators.every((width) => width === separators[0]))
  assert.ok(frame.split("\n").every((line) => displayWidth(line) <= 40))
})

test("narrow markdown tables wrap without dropping cell content", () => {
  const frame = render(React.createElement(MarkdownText, {
    width: 28,
    children: "| 名称 | 说明 |\n| --- | --- |\n| hello-world.cpp | 新增文件不会影响原有 JavaScript 项目的构建流程 |",
  })).lastFrame() ?? ""
  const compact = frame.replace(/\s+/g, "")
  for (const part of ["hello-world", ".cpp", "新增文件不", "会影响原有", "JavaScrip", "t项目的构", "建流程"]) assert.match(compact, new RegExp(part.replace(".", "\\.")))
  assert.doesNotMatch(frame, /…/)
  assert.ok(frame.split("\n").every((line) => displayWidth(line) <= 28))
})
