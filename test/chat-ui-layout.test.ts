import assert from "node:assert/strict"
import { stripVTControlCharacters } from "node:util"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { Box, Text } from "ink"
import { formatElapsedTime, TranscriptLine, WelcomeHeader } from "../src/ui/chat-app.js"
import { IMAGE_ATTACHMENT_TOKEN } from "../src/ui/attachment-model.js"
import { composerInputContent } from "../src/ui/components/chat-composer.js"
import { Composer } from "../src/ui/components/composer.js"
import { RunningStatus } from "../src/ui/components/chat-activity.js"
import { TranscriptBlock } from "../src/ui/components/transcript-block.js"
import { transcriptBoundary } from "../src/ui/transcript-layout.js"
import { displayWidth } from "../src/ui/terminal-text.js"
import { visibleFrame } from "./support/chat-ui.js"

test("elapsed time uses compact second, minute, and hour units", () => {
  assert.equal(formatElapsedTime(0), "0s")
  assert.equal(formatElapsedTime(59.9), "59s")
  assert.equal(formatElapsedTime(60), "1m")
  assert.equal(formatElapsedTime(197), "3m 17s")
  assert.equal(formatElapsedTime(3_600), "1h")
  assert.equal(formatElapsedTime(3_845), "1h 4m")
})

test("welcome header uses a branded wide layout and a compact narrow fallback", () => {
  const common = {
    workspace: "/Users/example/Projects/a-very-long-project-name",
    model: "ark/glm-5.2",
    sessionId: "session_very_long_identifier",
    restored: false,
  }
  const wide = render(React.createElement(WelcomeHeader, { ...common, width: 110 }))
  const wideFrame = visibleFrame(wide)
  assert.match(wideFrame, /____   ___/)
  assert.match(wideFrame, /›_ do-code/)
  assert.match(wideFrame, /ark\/glm-5\.2/)
  assert.match(wideFrame, /Type \/ for commands/)
  wide.unmount()

  const narrow = render(React.createElement(WelcomeHeader, { ...common, width: 42 }))
  const narrowFrame = visibleFrame(narrow)
  assert.doesNotMatch(narrowFrame, /____   ___/)
  assert.match(narrowFrame, /›_ do-code/)
  assert.match(narrowFrame, /Workspace/)
  assert.match(narrowFrame, /…/)
  narrow.unmount()
})

test("welcome header uses terminal-stable ASCII art at responsive boundaries", () => {
  const common = { workspace: "/tmp/project", model: "ark/glm-5.2", sessionId: "session_test", restored: false }
  for (const width of [75, 76, 77, 100, 171]) {
    const view = render(React.createElement(WelcomeHeader, { ...common, width }))
    const frame = visibleFrame(view)
    assert.doesNotMatch(frame, /[█╔╗╚╝║]/)
    assert.ok(frame.split("\n").every((line) => displayWidth(line) <= width), `rendered line exceeded ${width} columns`)
    view.unmount()
  }
})

test("welcome header respects narrow widths with Chinese workspace text", () => {
  for (const width of [24, 28, 36, 48]) {
    const view = render(React.createElement(WelcomeHeader, {
      workspace: "/Users/example/工作项目/一个很长的中文项目名称",
      model: "provider/a-very-long-model-name",
      sessionId: "session_very_long_identifier",
      restored: false,
      width,
      language: "zh",
    }))
    assert.ok((view.lastFrame() ?? "").split("\n").every((line) => displayWidth(line) <= width), `header exceeded ${width} cells`)
    view.unmount()
  }
})

test("transcript distinguishes roles without repeating role names", () => {
  const user = render(React.createElement(TranscriptLine, {
    item: { id: 1, kind: "user", text: "Please inspect this project" },
    width: 80,
  }))
  assert.equal(stripVTControlCharacters(user.lastFrame() ?? "").trim(), "› Please inspect this project")
  assert.match(user.lastFrame() ?? "", /\u001b\[90m.*›/)
  assert.doesNotMatch(user.lastFrame() ?? "", /You/)
  user.unmount()

  const assistant = render(React.createElement(TranscriptLine, {
    item: { id: 2, kind: "assistant", text: "Inspection complete." },
    width: 80,
  }))
  assert.equal((assistant.lastFrame() ?? "").trim(), "Inspection complete.")
  assert.doesNotMatch(assistant.lastFrame() ?? "", /do-code/)
  assistant.unmount()
})

test("user turns keep one padding row above and below single-line and multiline content", () => {
  for (const text of ["Single-line user turn", "第一行\n第二行\n第三行"]) {
    const view = render(React.createElement(TranscriptLine, {
      item: { id: 1, kind: "user", text },
      width: 40,
    }))
    const lines = visibleFrame(view).split("\n")
    const content = text.split("\n")
    const firstLine = lines.findIndex((line) => line.includes(content[0]!))
    const lastLine = lines.findIndex((line) => line.includes(content.at(-1)!))

    assert.ok(firstLine > 0, "user text should have one padding row above it")
    assert.equal(lines[firstLine - 1]?.trim(), "")
    assert.equal(lines[lastLine + 1]?.trim(), "")
    assert.equal(lines.length, content.length + 2)
    view.unmount()
  }
})

test("transcript message bodies share one terminal-cell baseline", () => {
  const cases = [
    { item: { id: 1, kind: "user" as const, text: "中文用户消息" }, body: "中文用户消息" },
    { item: { id: 2, kind: "assistant" as const, text: "中文回答" }, body: "中文回答" },
    { item: { id: 3, kind: "tool" as const, tools: [{ name: "read_file", args: { path: "src/main.ts" }, ok: true, output: "读取完成" }] }, body: "检查了项目" },
    { item: { id: 4, kind: "info" as const, text: "权限已授予" }, body: "权限已授予" },
    { item: { id: 5, kind: "error" as const, text: "执行失败" }, body: "执行失败" },
  ]

  for (const { item, body } of cases) {
    const view = render(React.createElement(TranscriptLine, { item, width: 80, language: "zh" }))
    const line = visibleFrame(view).split("\n").find((candidate) => candidate.includes(body)) ?? ""
    assert.equal(line.indexOf(body), 2, `${item.kind} body should begin in column 3`)
    view.unmount()
  }
})

test("system actions use one dot marker and distinguish state with color", () => {
  const cases = [
    { item: { id: 1, kind: "tool" as const, tools: [{ name: "read_file", args: { path: "src/main.ts" }, ok: true, output: "done" }] }, legacy: /[✓✗✕!↻]/ },
    { item: { id: 2, kind: "tool" as const, tools: [{ name: "read_file", args: { path: "src/main.ts" }, ok: false, output: "failed" }] }, legacy: /[✓✗✕!↻]/ },
    { item: { id: 3, kind: "info" as const, text: "Permission denied" }, legacy: /[✓✗✕!↻]/ },
    { item: { id: 4, kind: "error" as const, text: "Request failed" }, legacy: /[✓✗✕!↻]/ },
    { item: { id: 5, kind: "resume" as const, title: "Session", visibleCount: 1, conversationCount: 1, toolCount: 0 }, legacy: /[✓✗✕!↻]/ },
  ]

  for (const { item, legacy } of cases) {
    const view = render(React.createElement(TranscriptLine, { item, width: 80 }))
    const frame = visibleFrame(view)
    assert.match(frame, /^•/)
    assert.doesNotMatch(frame, legacy)
    view.unmount()
  }
})

test("transcript dividers mark tool-to-assistant phase changes only", () => {
  const tool = { id: 1, kind: "tool" as const, tools: [{ name: "read_file", args: { path: "src/main.ts" }, ok: true, output: "done" }] }
  const assistant = { id: 2, kind: "assistant" as const, text: "阶段结论" }
  const continuation = { id: 3, kind: "assistant" as const, text: "继续", continuation: true }
  const plan = { id: 4, kind: "plan" as const, plan: { title: "计划", summary: "说明", steps: ["执行"] } }
  const user = { id: 5, kind: "user" as const, text: "继续处理" }
  const secondTool = { id: 6, kind: "tool" as const, tools: [{ name: "glob", args: { pattern: "src/**" }, ok: true, output: "src/main.ts" }] }

  assert.equal(transcriptBoundary(undefined, assistant), "none")
  assert.equal(transcriptBoundary(tool, assistant), "divider")
  assert.equal(transcriptBoundary(tool, plan), "divider")
  assert.equal(transcriptBoundary(tool, continuation), "none")
  assert.equal(transcriptBoundary(tool, user), "space")
  assert.equal(transcriptBoundary(tool, secondTool), "space")
  assert.equal(transcriptBoundary(assistant, secondTool), "space")
})

test("tool-to-assistant divider replaces the normal boundary row", () => {
  const width = 48
  const tool = { id: 1, kind: "tool" as const, tools: [{ name: "read_file", args: { path: "src/main.ts" }, ok: true, output: "done" }] }
  const assistant = { id: 2, kind: "assistant" as const, text: "阶段结论" }
  const view = render(React.createElement(Box, { flexDirection: "column", width },
    React.createElement(TranscriptBlock, { first: true, width }, React.createElement(TranscriptLine, { item: tool, width, language: "zh" })),
    React.createElement(TranscriptBlock, { boundary: transcriptBoundary(tool, assistant), width }, React.createElement(TranscriptLine, { item: assistant, width, language: "zh" })),
  ))
  const lines = stripVTControlCharacters(view.lastFrame() ?? "").split("\n")
  const toolLine = lines.findIndex((line) => line.includes("检查了项目"))
  const assistantLine = lines.findIndex((line) => line.includes("阶段结论"))
  assert.ok(toolLine >= 0 && assistantLine > toolLine)
  assert.equal(lines[assistantLine - 1]?.trim(), "")
  assert.match(lines[assistantLine - 2] ?? "", /^─{48}$/)
  assert.equal(lines[assistantLine - 3]?.trim(), "")
  assert.equal(assistantLine, toolLine + 4)
  assert.ok(lines.every((line) => displayWidth(line) <= width))
  view.unmount()
})

test("conversation rows wrap Chinese and emoji within the current terminal width", () => {
  for (const width of [28, 40, 72]) {
    const item = { id: 1, kind: "assistant" as const, text: "中文回答 🚀 ".repeat(20) }
    const view = render(React.createElement(Box, { width }, React.createElement(TranscriptLine, { item, width, language: "zh" })))
    assert.ok((view.lastFrame() ?? "").split("\n").every((line) => displayWidth(line) <= width), `message exceeded ${width} cells`)
    view.unmount()
  }
})

test("composer reflows without duplicating its input surface", () => {
  const composer = (width: number) => React.createElement(Box, { width }, React.createElement(Composer, {
    running: false,
    input: React.createElement(Text, null, "输入任务或 @文件路径"),
    suggestions: React.createElement(Text, null, "› /help  查看帮助"),
    status: React.createElement(React.Fragment, null, "model · 0%"),
    statusRight: React.createElement(Text, null, "计划"),
  }))
  const view = render(composer(72))
  view.rerender(composer(32))
  const frame = view.lastFrame() ?? ""
  const plainFrame = stripVTControlCharacters(frame)
  assert.equal(plainFrame.split("输入任务或 @文件路径").length - 1, 1)
  assert.equal(plainFrame.split("› /help").length - 1, 1)
  const inputLine = plainFrame.split("\n").findIndex((line) => line.includes("输入任务或 @文件路径"))
  const statusLine = plainFrame.split("\n").findIndex((line) => line.includes("model · 0%"))
  assert.match(plainFrame.split("\n")[inputLine] ?? "", /^› 输入任务或 @文件路径/)
  assert.match(plainFrame.split("\n")[statusLine] ?? "", /^model · 0%\s+计划$/)
  assert.equal(plainFrame.split("\n")[inputLine - 1]?.trim(), "")
  assert.equal(plainFrame.split("\n")[inputLine + 1]?.trim(), "")
  assert.equal(statusLine, inputLine + 2)
  assert.match(frame.split("\n").find((line) => line.includes("输入任务或 @文件路径")) ?? "", /\u001b\[36m.*›/)
  assert.ok(plainFrame.split("\n").every((line) => displayWidth(line) <= 32))
  view.unmount()
})

test("composer retains bottom padding when the cursor first soft-wraps", (t) => {
  const input = "123456789012345678"
  const view = render(React.createElement(Box, { width: 20 }, React.createElement(Composer, {
    running: false,
    input: React.createElement(Text, null, composerInputContent(input, input.length)),
    status: "model · 0%",
  })))
  t.after(() => view.unmount())

  const lines = stripVTControlCharacters(view.lastFrame() ?? "").split("\n")
  const statusLine = lines.findIndex((line) => line.includes("model · 0%"))
  assert.equal(lines[statusLine - 1]?.trim(), "")
  assert.match(lines[statusLine - 2] ?? "", /8/)
  assert.ok(lines.slice(0, statusLine).filter((line) => line.trim() === "").length >= 3)
})

test("composer input keeps blue image labels and cursor highlighting", (t) => {
  const value = `before ${IMAGE_ATTACHMENT_TOKEN} after`
  const ordinary = render(React.createElement(Text, null, composerInputContent(value, 0)))
  const selected = render(React.createElement(Text, null, composerInputContent(value, 7)))
  t.after(() => { ordinary.unmount(); selected.unmount() })

  const ordinaryFrame = ordinary.lastFrame() ?? ""
  assert.match(stripVTControlCharacters(ordinaryFrame), /before\s+\[Image #1\]\s+after/)
  assert.match(ordinaryFrame, /\u001b\[36m\s+\[Image #1\]\s+\u001b\[39m/)
  assert.match(selected.lastFrame() ?? "", /\u001b\[7m\s+\[Image #1\]\s+\u001b\[27m/)
})

test("composer owns two visual rows above the complete input control surface", () => {
  const view = render(React.createElement(Box, { flexDirection: "column", width: 72 },
    React.createElement(Text, null, "Completed answer"),
    React.createElement(Composer, {
      running: false,
      input: React.createElement(Text, null, "› /rew"),
      suggestions: React.createElement(Text, null, "› /rewind  Rewind chat, files, or both"),
      status: React.createElement(React.Fragment, null, "model · 1%"),
    }),
  ))
  const lines = (view.lastFrame() ?? "").split("\n")
  const answerLine = lines.findIndex((line) => line.includes("Completed answer"))
  const suggestionLine = lines.findIndex((line) => line.includes("/rewind"))

  assert.ok(answerLine >= 0 && suggestionLine > answerLine)
  assert.equal(lines[answerLine + 1]?.trim(), "")
  assert.equal(lines[answerLine + 2]?.trim(), "")
  assert.equal(suggestionLine, answerLine + 3)
  view.unmount()
})

test("running status renders above the padded single-line composer", () => {
  const view = render(React.createElement(Box, { flexDirection: "column", width: 72 },
    React.createElement(Composer, {
      running: true,
      input: React.createElement(Text, null, "任务正在运行；按 Enter 将消息加入队列"),
      activity: React.createElement(RunningStatus, { activityEpoch: 1, activeTool: null, reasoningCharacters: 0, language: "zh" }),
      status: React.createElement(React.Fragment, null, "model · 1%"),
    }),
  ))
  const lines = stripVTControlCharacters(view.lastFrame() ?? "").split("\n")
  const input = lines.findIndex((line) => line.includes("任务正在运行"))
  const activity = lines.findIndex((line) => line.includes("思考中"))
  const status = lines.findIndex((line) => line.includes("model · 1%"))
  assert.equal(lines[activity + 1]?.trim(), "")
  assert.equal(input, activity + 2)
  assert.equal(lines[input + 1]?.trim(), "")
  assert.equal(status, input + 2)
  assert.match(lines[input] ?? "", /^› 任务正在运行/)
  assert.match(lines[status] ?? "", /^model · 1%/)
  assert.doesNotMatch(lines.slice(activity, status + 1).join("\n"), /─/)
  view.unmount()
})
