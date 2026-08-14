import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { stripVTControlCharacters } from "node:util"
import { createMarkdownStreamer, render } from "@tree201/markdansi"
import { displayWidth } from "../src/ui/terminal-text.js"

const plainOptions = { color: false, hyperlinks: false } as const
const visibleLines = (value: string) => stripVTControlCharacters(value).split("\n").filter((line) => line.length > 0)

function assertWithinWidth(value: string, width: number) {
  const oversized = visibleLines(value).filter((line) => displayWidth(line) > width)
  assert.deepEqual(oversized, [])
}

test("markdansi renders core GFM structures without source markers", () => {
  const output = render([
    "# 标题",
    "",
    "段落包含 **粗体**、*斜体*、~~删除线~~ 和 `inlineCode`。",
    "",
    "> 引用包含 [链接](https://example.com)。",
    "",
    "1. 第一项",
    "   - 嵌套项",
    "   - [x] 已完成",
    "",
    "---",
  ].join("\n"), { ...plainOptions, width: 60 })
  const visible = stripVTControlCharacters(output)
  assert.match(visible, /标题/)
  assert.match(visible, /粗体.*斜体.*删除线.*inlineCode/)
  assert.match(visible, /│ 引用包含 链接 \(https:\/\/example\.com\)/)
  assert.match(visible, /1\. 第一项/)
  assert.match(visible, /嵌套项/)
  assert.doesNotMatch(visible, /\*\*|~~|`inlineCode`|\[链接\]\(/)
})

test("published Markdansi renders LaTeX math as terminal Unicode", () => {
  const output = render([
    "给定非纯函数 $f_{\\mathrm{impure}}:X\\to Y$。",
    "",
    "$$",
    "f:\\Gamma\\times X\\to\\Gamma\\times Y \\tag{1}",
    "$$",
    "",
    "Use `$PATH`, pay $100, and keep code unchanged:",
    "",
    "```ts",
    "const formula = '$x$'",
    "```",
  ].join("\n"), { ...plainOptions, width: 60 })
  const visible = stripVTControlCharacters(output)
  assert.match(visible, /fᵢₘₚᵤᵣₑ:X→ Y/)
  assert.match(visible, /f:Γ× X→Γ× Y\s+\(1\)/)
  assert.match(visible, /\$PATH.*\$100/)
  assert.match(visible, /const formula = '\$x\$'/)
  assert.doesNotMatch(visible, /\\mathrm|\\Gamma|\\times|\\tag|\$\$/)
})

test("markdansi keeps fenced code and tables within ordinary viewport widths", () => {
  const width = 36
  const output = render([
    "```ts",
    "const message = '中文 emoji 🚀 and a longer source line'",
    "```",
    "",
    "| 名称 | 说明 |",
    "| :--- | ---: |",
    "| 中文项目 | 已完成 🚀 |",
  ].join("\n"), { ...plainOptions, width, codeWrap: true, tableTruncate: true })
  const visible = stripVTControlCharacters(output)
  assert.match(visible, /const message/)
  assert.match(visible, /中文项目/)
  assert.match(visible, /┌.*┬.*┐/)
  assertWithinWidth(output, width)
})

test("markdansi recalculates layout when width changes", () => {
  const source = "This paragraph uses ordinary word boundaries to verify that terminal width changes trigger a fresh layout."
  const wide = render(source, { ...plainOptions, width: 48 })
  const narrow = render(source, { ...plainOptions, width: 20 })
  const wideAgain = render(source, { ...plainOptions, width: 48 })
  assert.ok(visibleLines(narrow).length > visibleLines(wide).length)
  assert.equal(wideAgain, wide)
  assertWithinWidth(narrow, 20)
})

test("markdansi streaming buffers fenced code and tables until complete", () => {
  const streamer = createMarkdownStreamer({
    render: (source) => render(source, { ...plainOptions, width: 40 }),
    spacing: "single",
  })
  const prose = streamer.push("开始说明\n")
  const openFence = streamer.push("```ts\nconst value = 1\n")
  const closedFence = streamer.push("```\n")
  const tableHeader = streamer.push("| 名称 | 状态 |\n| --- | --- |\n")
  const tableRow = streamer.push("| do-code | 完成 |\n")
  const finished = streamer.finish()
  assert.match(stripVTControlCharacters(prose), /开始说明/)
  assert.equal(openFence, "")
  assert.match(stripVTControlCharacters(closedFence), /const value = 1/)
  assert.equal(tableHeader, "")
  assert.equal(tableRow, "")
  assert.match(stripVTControlCharacters(finished), /do-code.*完成/s)
})

test("published Markdansi fork supports do-code's Node 20 runtime", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../node_modules/@tree201/markdansi/package.json", import.meta.url), "utf8")) as { engines?: { node?: string } }
  assert.equal(packageJson.engines?.node, ">=20.19.0")
})

test("pinned markdansi fork hard-wraps long terminal tokens", () => {
  const width = 20
  const values = [
    "resolveRonaReasonIdWithConfigurationFallback",
    "这是一个完全没有空格的超长中文段落用于验证终端换行行为",
    "👨‍👩‍👧‍👦🚀🎉✅👩🏽‍💻🌏🧪📦🔧",
  ]
  for (const value of values) {
    const output = render(value, { ...plainOptions, width })
    assertWithinWidth(output, width)
    assert.equal(visibleLines(output).join(""), value)
  }
})
