import assert from "node:assert/strict"
import React from "react"
import test from "node:test"
import { render } from "ink-testing-library"
import { Box, Text } from "ink"
import { AgentConversation } from "../src/agent.js"
import type { AgentEvent, ChatModel, Message } from "../src/protocol.js"
import { ApprovalBridge, ApprovalDialog, askAnswerPairs, boundedLiveOutput, ChatApp, formatElapsedTime, inlineViewerHeight, PermissionModeDialog, PlanReviewBridge, PlanReviewDialog, QuestionBridge, QuestionDialog, TranscriptLine, TranscriptViewer, transcriptViewerText, WelcomeHeader, type ChatAppProps, type TranscriptItem } from "../src/ui/chat-app.js"
import { displayWidth } from "../src/ui/terminal-text.js"
import { Composer } from "../src/ui/components/composer.js"
import { DialogManager, DialogSurface } from "../src/ui/components/dialog-manager.js"

const tick = () => new Promise((resolve) => setTimeout(resolve, 40))
const currentScreen = (frame: string) => {
  const start = frame.lastIndexOf("›_ do-code")
  return start < 0 ? frame : frame.slice(start)
}

test("inline message viewer never grows into a full-terminal transient frame", () => {
  assert.equal(inlineViewerHeight(190, 60), 38)
  assert.equal(inlineViewerHeight(120, 40), 24)
  assert.equal(inlineViewerHeight(100, 28), 20)
  assert.equal(inlineViewerHeight(60, 12), 5)
  assert.ok(inlineViewerHeight(240, 30) <= 22, "the composer and status rows must remain visible")
})

test("streaming output remains bounded inside the native scroll viewport", () => {
  const output = Array.from({ length: 80 }, (_, index) => `streaming-line-${index}-${"x".repeat(50)}`).join("\n")
  const bounded = boundedLiveOutput(output, 40, 8)
  assert.equal(bounded.truncated, true)
  assert.ok(bounded.text.split("\n").length <= 8)
  assert.match(bounded.text, /streaming-line-79/)
  assert.doesNotMatch(bounded.text, /streaming-line-0-/)
})

test("message viewer exposes full history through a bounded scroll window", () => {
  const items: TranscriptItem[] = [
    { id: 1, kind: "user", text: "第一条问题" },
    { id: 2, kind: "assistant", text: Array.from({ length: 12 }, (_, index) => `回答第 ${index + 1} 行`).join("\n") },
    { id: 3, kind: "user", text: "最后一条问题" },
  ]
  const transcript = transcriptViewerText(items, "zh")
  assert.match(transcript, /第一条问题/)
  assert.match(transcript, /最后一条问题/)

  const top = render(React.createElement(TranscriptViewer, { items, offset: 0, width: 48, height: 9, language: "zh" }))
  assert.match(top.lastFrame() ?? "", /消息查看模式/)
  assert.match(top.lastFrame() ?? "", /第一条问题/)
  assert.doesNotMatch(top.lastFrame() ?? "", /最后一条问题/)
  top.unmount()

  const bottom = render(React.createElement(TranscriptViewer, { items, offset: Number.MAX_SAFE_INTEGER, width: 48, height: 9, language: "zh" }))
  assert.match(bottom.lastFrame() ?? "", /最后一条问题/)
  assert.match(bottom.lastFrame() ?? "", /Ctrl\+T\/Esc 返回/)
  bottom.unmount()
})

test("message viewer keeps a fixed viewport while long history is resized", () => {
  const items: TranscriptItem[] = Array.from({ length: 300 }, (_, index) => ({
    id: index + 1,
    kind: index % 2 === 0 ? "user" as const : "assistant" as const,
    text: `message-${index} ${"内容".repeat(36)}`,
  }))
  const view = render(React.createElement(TranscriptViewer, {
    items, offset: Number.MAX_SAFE_INTEGER, width: 80, height: 20, language: "zh",
  }))
  assert.equal((view.lastFrame() ?? "").split("\n").length, 20)
  assert.match(view.lastFrame() ?? "", /message-299/)

  view.rerender(React.createElement(TranscriptViewer, {
    items, offset: Number.MAX_SAFE_INTEGER, width: 120, height: 24, language: "zh",
  }))
  assert.equal((view.lastFrame() ?? "").split("\n").length, 24)
  assert.match(view.lastFrame() ?? "", /message-299/)
  view.unmount()
})

test("Ctrl+T opens and closes the frozen message viewer", async () => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_viewer", restored: true,
    initialMessages: [{ role: "user", content: "remember this question" }, { role: "assistant", content: "remember this answer" }],
    conversation, language: "en", approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [],
    resumeSession: async () => { throw new Error("unused") }, renameCurrentSession: async () => { throw new Error("unused") },
    exportCurrentSession: async () => "unused", save: async () => {}, reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  await tick()
  view.stdin.write("\u0014")
  await tick()
  assert.match(view.lastFrame() ?? "", /Message viewer/)
  assert.match(view.lastFrame() ?? "", /remember this question/)
  assert.match(view.lastFrame() ?? "", /remember this answer/)
  assert.match(view.lastFrame() ?? "", /Viewing messages; press Ctrl\+T or Esc to return to input/)

  await new Promise((resolve) => setTimeout(resolve, 160))
  view.stdin.write("\u0014")
  await tick(); await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /Message viewer/)
  assert.match(view.lastFrame() ?? "", /Enter a task or @file path/)
  view.stdin.write("viewer-regression")
  await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /viewer-regression/)
  view.unmount()
})

test("successful internal task updates stay out of chat and remain available in Ctrl+T", async () => {
  let finishModel: (() => void) | undefined
  const model: ChatModel = { async complete() {
    await new Promise<void>((resolve) => { finishModel = resolve })
    return { content: "done", toolCalls: [] }
  } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  let sink: ((event: AgentEvent) => void) | null = null
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_task_progress", restored: false,
    initialMessages: [], conversation, language: "zh", approvalBridge: new ApprovalBridge(), attachEventSink: (next) => { sink = next },
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [],
    resumeSession: async () => { throw new Error("unused") }, renameCurrentSession: async () => { throw new Error("unused") },
    exportCurrentSession: async () => "unused", save: async () => {}, reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  await tick()
  view.stdin.write("执行任务\r")
  await tick()
  const activeSink = sink as ((event: AgentEvent) => void) | null
  assert.ok(activeSink)
  const args = { items: [
    { id: "1", content: "检查项目", status: "completed" },
    { id: "2", content: "运行测试", status: "in_progress" },
  ] }
  activeSink({ protocolVersion: 1, turnId: "turn_todo", type: "tool.started", step: 1, callId: "todo_1", name: "todo_write", args })
  activeSink({ protocolVersion: 1, turnId: "turn_todo", type: "tool.completed", step: 1, callId: "todo_1", name: "todo_write", ok: true, output: "✓ 1: 检查项目\n→ 2: 运行测试" })
  await tick(); await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /任务 1\/2/)
  assert.doesNotMatch(view.lastFrame() ?? "", /更新计划|任务进度已更新/)

  view.stdin.write("\u0014")
  await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /消息查看模式/)
  assert.match(view.lastFrame() ?? "", /检查项目/)
  assert.match(view.lastFrame() ?? "", /运行测试/)
  view.stdin.write("\u001b")
  finishModel?.()
  await tick(); await tick()
  view.unmount()
})

test("blocked and failed task updates remain visible while successful updates can be hidden", () => {
  const hidden = render(React.createElement(TranscriptLine, {
    item: { id: 1, kind: "tool", hidden: true, tools: [{ name: "todo_write", ok: true, args: { items: [] }, output: "Task plan cleared" }] },
    width: 80,
    language: "zh",
  }))
  assert.equal((hidden.lastFrame() ?? "").trim(), "")
  hidden.unmount()

  const blocked = render(React.createElement(TranscriptLine, {
    item: { id: 2, kind: "tool", tools: [{ name: "todo_write", ok: true, args: { items: [{ id: "1", content: "等待权限", status: "blocked" }] }, output: "! 1: 等待权限" }] },
    width: 80,
    language: "zh",
  }))
  assert.match(blocked.lastFrame() ?? "", /任务受阻 · 1 项/)
  blocked.unmount()

  const failed = render(React.createElement(TranscriptLine, {
    item: { id: 3, kind: "tool", tools: [{ name: "todo_write", ok: false, output: "invalid items" }] },
    width: 80,
    language: "zh",
  }))
  assert.match(failed.lastFrame() ?? "", /更新任务进度失败/)
  failed.unmount()
})

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
  assert.match(wide.lastFrame() ?? "", /____   ___/)
  assert.match(wide.lastFrame() ?? "", /›_ do-code/)
  assert.match(wide.lastFrame() ?? "", /ark\/glm-5\.2/)
  assert.match(wide.lastFrame() ?? "", /Type \/ for commands/)
  wide.unmount()

  const narrow = render(React.createElement(WelcomeHeader, { ...common, width: 42 }))
  assert.doesNotMatch(narrow.lastFrame() ?? "", /____   ___/)
  assert.match(narrow.lastFrame() ?? "", /›_ do-code/)
  assert.match(narrow.lastFrame() ?? "", /Workspace/)
  assert.match(narrow.lastFrame() ?? "", /…/)
  narrow.unmount()
})

test("welcome header uses terminal-stable ASCII art at responsive boundaries", () => {
  const common = { workspace: "/tmp/project", model: "ark/glm-5.2", sessionId: "session_test", restored: false }
  for (const width of [75, 76, 77, 100, 171]) {
    const view = render(React.createElement(WelcomeHeader, { ...common, width }))
    const frame = view.lastFrame() ?? ""
    assert.doesNotMatch(frame, /[█╔╗╚╝║]/)
    assert.ok(frame.split("\n").every((line) => line.length <= width), `rendered line exceeded ${width} columns`)
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
  assert.equal((user.lastFrame() ?? "").trim(), "› Please inspect this project")
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

test("edit activities render a compact line-numbered Codex-style diff", () => {
  const view = render(React.createElement(TranscriptLine, {
    item: {
      id: 3,
      kind: "tool",
      tools: [{
        name: "edit_file",
        args: {},
        ok: true,
        output: "done",
        presentation: {
          kind: "edit",
          fileChanges: [{
            path: "src/main.js",
            additions: 1,
            deletions: 1,
            diffLines: [
              { kind: "remove", text: "const oldValue = true", oldLine: 140 },
              { kind: "add", text: "const newValue = true", newLine: 140 },
            ],
          }],
        },
      }],
    },
    width: 72,
    language: "en",
  }))
  const frame = view.lastFrame() ?? ""
  assert.match(frame, /• Edited src\/main\.js \(\+1 -1\)/)
  assert.match(frame, /140 - const oldValue = true/)
  assert.match(frame, /140 \+ const newValue = true/)
  const diffRows = frame.split("\n").filter((line) => /140 [-+] const/.test(line))
  assert.ok(diffRows.every((line) => line.indexOf("140") === 4), "line numbers should be right-aligned in a seven-cell gutter")
  assert.equal((frame.match(/src\/main\.js/g) ?? []).length, 1)
  view.unmount()
})

test("multi-file edit headers and code share the Codex seven-cell line-number grid", () => {
  const view = render(React.createElement(TranscriptLine, {
    item: {
      id: 31,
      kind: "tool",
      tools: [{
        name: "apply_patch",
        args: {},
        ok: true,
        output: "done",
        presentation: {
          kind: "edit",
          fileChanges: [
            {
              path: "src/main.js",
              additions: 1,
              deletions: 0,
              diffLines: [{ kind: "add", text: "makeNightLightsTexture,", newLine: 12 }],
            },
            {
              path: "src/style.css",
              additions: 1,
              deletions: 0,
              diffLines: [{ kind: "add", text: ".panel {}", newLine: 220 }],
            },
          ],
        },
      }],
    },
    width: 72,
    language: "en",
  }))
  const frame = view.lastFrame() ?? ""
  assert.match(frame, /^  └ src\/main\.js \(\+1 -0\)$/m)
  assert.match(frame, /^     12 \+ makeNightLightsTexture,$/m)
  assert.match(frame, /^    220 \+ \.panel \{\}$/m)
  view.unmount()
})

test("multi-file diffs keep one visual row before the next tool activity", () => {
  const editItem = {
    id: 32,
    kind: "tool" as const,
    tools: [{
      name: "apply_patch",
      args: {},
      ok: true,
      output: "done",
      presentation: {
        kind: "edit" as const,
        fileChanges: [
          {
            path: "src/main.js",
            additions: 1,
            deletions: 0,
            diffLines: [{ kind: "add" as const, text: "const ready = true", newLine: 12 }],
          },
          {
            path: "src/style.css",
            additions: 1,
            deletions: 0,
            diffLines: [{ kind: "add" as const, text: ".panel {}", newLine: 220 }],
          },
        ],
      },
    }],
  }
  const nextItem = {
    id: 33,
    kind: "tool" as const,
    tools: [{
      name: "read_file",
      args: { path: "README.md" },
      ok: true,
      output: "done",
      presentation: { kind: "explore" as const, targets: ["README.md"] },
    }],
  }
  const view = render(React.createElement(Box, { flexDirection: "column", width: 72 },
    React.createElement(TranscriptLine, { item: editItem, width: 72, language: "en", nextKind: "tool" }),
    React.createElement(TranscriptLine, { item: nextItem, width: 72, language: "en" }),
  ))
  const lines = (view.lastFrame() ?? "").split("\n")
  const finalDiffLine = lines.findIndex((line) => line.includes(".panel {}"))
  const nextActivityLine = lines.findIndex((line, index) => index > finalDiffLine && line.includes("Explored"))
  assert.ok(finalDiffLine >= 0 && nextActivityLine > finalDiffLine)
  assert.equal(lines[finalDiffLine + 1]?.trim(), "")
  assert.equal(nextActivityLine, finalDiffLine + 2)
  view.unmount()
})

test("line-number gaps render explicit unchanged-region omissions without hiding changed lines", () => {
  const view = render(React.createElement(TranscriptLine, {
    item: {
      id: 4,
      kind: "tool",
      tools: [{
        name: "apply_patch",
        args: {},
        ok: true,
        output: "done",
        presentation: {
          kind: "edit",
          fileChanges: [{
            path: "src/main.js",
            additions: 8,
            deletions: 0,
            diffLines: [
              { kind: "add", text: "const first = true", newLine: 10 },
              { kind: "add", text: "const second = true", newLine: 20 },
            ],
          }],
        },
      }],
    },
    width: 72,
    language: "zh",
  }))
  const frame = view.lastFrame() ?? ""
  assert.match(frame, /^\s*⋮\s*$/m)
  assert.doesNotMatch(frame, /省略.*行修改/)
  view.unmount()
})

test("user turns use a three-line surface with vertically centered text", () => {
  const view = render(React.createElement(TranscriptLine, {
    item: { id: 1, kind: "user", text: "Centered user turn" },
    width: 40,
  }))
  const lines = (view.lastFrame() ?? "").split("\n")
  const messageLine = lines.findIndex((line) => line.includes("Centered user turn"))

  assert.ok(messageLine > 0, "user text should have one surface row above it")
  assert.equal(lines[messageLine - 1]?.trim(), "")
  assert.equal(lines[messageLine + 1]?.trim(), "")
  view.unmount()
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
    const line = (view.lastFrame() ?? "").split("\n").find((candidate) => candidate.includes(body)) ?? ""
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
    const frame = view.lastFrame() ?? ""
    assert.match(frame, /^•/)
    assert.doesNotMatch(frame, legacy)
    view.unmount()
  }
})

test("conversation rows wrap Chinese and emoji within the current terminal width", () => {
  for (const width of [28, 40, 72]) {
    const item = { id: 1, kind: "assistant" as const, text: "中文回答 🚀 ".repeat(20) }
    const view = render(React.createElement(Box, { width }, React.createElement(TranscriptLine, { item, width, language: "zh" })))
    assert.ok((view.lastFrame() ?? "").split("\n").every((line) => displayWidth(line) <= width), `message exceeded ${width} cells`)
    view.unmount()
  }
})

test("Gemini-style composer reflows without duplicating its input surface", () => {
  const composer = (width: number) => React.createElement(Box, { width }, React.createElement(Composer, {
    running: false,
    input: React.createElement(Text, null, React.createElement(Text, { color: "cyan" }, "› "), "输入任务或 @文件路径"),
    suggestions: React.createElement(Text, null, "› /help  查看帮助"),
    status: React.createElement(React.Fragment, null, "model · 0%"),
    statusRight: React.createElement(Text, null, "计划"),
  }))
  const view = render(composer(72))
  view.rerender(composer(32))
  const frame = view.lastFrame() ?? ""
  assert.equal(frame.split("输入任务或 @文件路径").length - 1, 1)
  assert.equal(frame.split("› /help").length - 1, 1)
  assert.match(frame.split("\n").find((line) => line.includes("model · 0%")) ?? "", /model · 0%\s+计划$/)
  assert.ok(frame.split("\n").every((line) => displayWidth(line) <= 32))
  view.unmount()
})

test("transient dialogs share one responsive control surface", () => {
  const width = 34
  const view = render(React.createElement(Box, { width },
    React.createElement(DialogManager, null,
      React.createElement(DialogSurface, { color: "yellow" },
        React.createElement(Text, { bold: true }, "需要批准这个操作"),
        React.createElement(Text, null, "› 1. 仅允许一次"),
        React.createElement(Text, { dimColor: true }, "↑↓ 选择 · Enter 确认 · Esc 拒绝"),
      ),
    ),
  ))
  const frame = view.lastFrame() ?? ""
  assert.match(frame, /需要批准这个操作/)
  assert.ok(frame.split("\n").every((line) => displayWidth(line) <= width))
  view.unmount()
})

test("agent questions separate title, prompt, options, and localized controls", () => {
  const view = render(React.createElement(Box, { width: 60 }, React.createElement(QuestionDialog, {
    question: "你希望主要优化哪个方向？",
    options: ["代码结构重构", "运行性能优化", "打包体积优化"],
    selectedIndex: 1,
    draft: "",
    language: "zh",
  })))
  const lines = (view.lastFrame() ?? "").split("\n")
  const title = lines.findIndex((line) => line.includes("需要你的输入"))
  const prompt = lines.findIndex((line) => line.includes("你希望主要优化哪个方向"))
  const firstOption = lines.findIndex((line) => line.includes("代码结构重构"))
  const controls = lines.findIndex((line) => line.includes("Enter 确认"))
  assert.ok(title >= 0 && prompt >= title + 2, "title and question should be visually separated")
  assert.ok(firstOption >= prompt + 2, "question and options should be visually separated")
  assert.ok(controls >= firstOption + 4, "controls should be visually separated from the option list")
  assert.ok(lines.every((line) => displayWidth(line) <= 60))
  view.unmount()
})

test("file approval uses a localized restrained Codex-style diff", () => {
  const view = render(React.createElement(Box, { width: 72 }, React.createElement(ApprovalDialog, {
    request: {
      tool: "edit_file",
      title: "Edit file src/earth.js",
      detail: "legacy raw detail",
      args: {
        path: "src/earth.js",
        old_text: "earthSystem.add(earth, clouds);\nearthSystem.add(nightLights);",
        new_text: "earthSystem.add(earth, clouds);\nearth.add(nightLights);",
      },
      decision: "ask",
      risk: "medium",
      reason: "File changes require approval",
      matchedRule: "mode.default",
      dangerous: false,
    },
    selectedIndex: 0,
    language: "zh",
    width: 72,
  })))
  const frame = view.lastFrame() ?? ""
  assert.match(frame, /修改 src\/earth\.js  中等风险/)
  assert.match(frame, /- earthSystem\.add\(nightLights\)/)
  assert.match(frame, /\+ earth\.add\(nightLights\)/)
  assert.match(frame, /允许修改这个文件吗/)
  assert.match(frame, /› 1\. 允许一次/)
  assert.match(frame, /3\. 始终允许此操作/)
  assert.doesNotMatch(frame, /Original|Updated|legacy raw detail|mode\.default/)
  assert.ok(frame.split("\n").every((line) => displayWidth(line) <= 72))
  view.unmount()
})

test("plan review keeps the dynamic confirmation compact while the full plan stays in scrollback", () => {
  const plan = {
    title: "拆分认证模块",
    summary: "保持行为兼容，拆分策略与传输层。",
    steps: ["提取策略", "迁移调用方", "运行回归测试"],
    files: ["src/auth.ts", "test/auth.test.ts"],
    verification: ["npm test"],
    risks: ["会话兼容性"],
  }
  const view = render(React.createElement(PlanReviewDialog, {
    plan,
    selectedIndex: 0,
    language: "zh",
  }))
  const frame = view.lastFrame() ?? ""
  assert.match(frame, /建议计划/)
  assert.match(frame, /拆分认证模块/)
  assert.match(frame, /完整计划已写入上方对话历史/)
  assert.match(frame, /1\. 执行/)
  assert.match(frame, /2\. 修改/)
  assert.match(frame, /取消/)
  assert.doesNotMatch(frame, /1\. 提取策略/)
  assert.doesNotMatch(frame, /逐项确认|自动编辑/)
  assert.ok(frame.split("\n").length <= 14, "the transient plan confirmation must stay viewport-safe")
  view.unmount()

  const transcript = render(React.createElement(TranscriptLine, {
    item: { id: 99, kind: "plan", plan },
    width: 80,
    language: "zh",
  }))
  const transcriptFrame = transcript.lastFrame() ?? ""
  assert.match(transcriptFrame, /1\. 提取策略/)
  assert.match(transcriptFrame, /src\/auth\.ts/)
  assert.match(transcriptFrame, /npm test/)
  transcript.unmount()
})

test("plan review pauses animated activity so terminal scrollback is not pulled back", async () => {
  let finishModel: (() => void) | undefined
  const model: ChatModel = {
    async complete() {
      await new Promise<void>((resolve) => { finishModel = resolve })
      return { content: "done", toolCalls: [] }
    },
  }
  const planReviewBridge = new PlanReviewBridge()
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_plan_scroll", restored: false,
    initialMessages: [], conversation, language: "zh", approvalBridge: new ApprovalBridge(), planReviewBridge,
    attachEventSink: () => {}, runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [],
    resumeSession: async () => { throw new Error("unused") }, renameCurrentSession: async () => { throw new Error("unused") },
    exportCurrentSession: async () => "unused", save: async () => {}, reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  await tick()
  view.stdin.write("制定计划\r")
  await tick()
  assert.match(view.lastFrame() ?? "", /思考中/)

  const decision = planReviewBridge.request({
    title: "长计划滚动回归",
    summary: "计划正文必须进入稳定的终端历史。",
    steps: Array.from({ length: 30 }, (_, index) => `步骤 ${index + 1}`),
    files: [], verification: ["npm test"], risks: [],
  })
  await tick()
  await tick()
  const frame = view.lastFrame() ?? ""
  assert.match(frame, /步骤 30/)
  assert.match(frame, /完整计划已写入上方对话历史/)
  assert.doesNotMatch(frame, /思考中/, "the animated spinner must be unmounted while plan review waits")
  const stableFrameCount = view.frames.length
  await new Promise((resolve) => setTimeout(resolve, 1_100))
  assert.equal(view.frames.length, stableFrameCount, "plan review must not redraw on a timer")

  view.stdin.write("\r")
  assert.equal(await decision, "execute")
  finishModel?.()
  await tick()
  view.unmount()
})

test("permission menu presents the three real do-code approval levels", () => {
  const view = render(React.createElement(PermissionModeDialog, {
    currentMode: "full-access",
    selectedIndex: 0,
    language: "zh",
  }))
  const frame = view.lastFrame() ?? ""
  assert.match(frame, /更新模型权限/)
  assert.match(frame, /请求批准/)
  assert.match(frame, /自动批准安全操作/)
  assert.match(frame, /完全访问（当前）/)
  assert.match(frame, /工作区外文件/)
  view.unmount()
})

test("agent interactions record the question before the answer without exposing ask_user", async () => {
  assert.deepEqual(askAnswerPairs({ questions: [{ id: "direction", header: "方向", question: "选择优化方向" }] }, JSON.stringify({ answers: { direction: "代码结构" } })), [
    { question: "[方向] 选择优化方向", answer: "代码结构" },
  ])

  const model: ChatModel = { async complete() { return { content: "done", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const questionBridge = new QuestionBridge()
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_question", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(), questionBridge, attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  await tick()
  const pendingAnswer = questionBridge.request("[Direction] Choose one", ["Structure", "Performance"])
  await tick()
  view.stdin.write("\r")
  assert.equal(await pendingAnswer, "Structure")
  await tick()
  const frame = view.lastFrame() ?? ""
  assert.ok(frame.indexOf("Ask: [Direction] Choose one") < frame.indexOf("Answer: Structure"))
  assert.doesNotMatch(frame, /ask_user/)
  view.unmount()
})

test("language command switches the live interface with second-level completion", async () => {
  const model:ChatModel={async complete(){return {content:"done",toolCalls:[]}}}
  const conversation=new AgentConversation({workspace:process.cwd(),model,approveShell:async()=>false})
  let selected=""
  let selectedThinking=""
  const props:ChatAppProps={
    workspace:process.cwd(),model:"test-model",approvalMode:"ask",sessionId:"session_language",restored:false,initialMessages:[],conversation,
    language:"en",setLanguage:async(language)=>{selected=language},approvalBridge:new ApprovalBridge(),attachEventSink:()=>{},
    thinkingMode:"auto",switchThinking:async(mode)=>{selectedThinking=mode;return {source:"config",sourceLabel:"test",preset:"test-model",provider:"test",modelId:"test-model",baseUrl:"https://example.com/v1",apiKey:"test",thinkingMode:mode,effectiveThinkingMode:mode}},
    runShellShortcut:async()=>({ok:true,output:""}),listSessions:async()=>[],resumeSession:async()=>{throw new Error("unused")},
    renameCurrentSession:async()=>{throw new Error("unused")},exportCurrentSession:async()=>"unused",save:async()=>{},
    reportError:async()=>({id:"err_test",file:"/tmp/error.json"}),
  }
  const view=render(React.createElement(ChatApp,props))
  view.stdin.write("/language ")
  await tick();await tick()
  assert.match(view.lastFrame()??"",/zh.*Chinese/)
  view.stdin.write("zh\r")
  await tick();await tick()
  assert.equal(selected,"zh")
  assert.match(view.frames.join("\n"),/语言已切换为中文/)
  assert.match(view.lastFrame()??"",/输入任务或 @文件路径/)
  view.stdin.write("/")
  await tick()
  assert.match(view.lastFrame()??"",/\/help  查看可用命令/)
  view.stdin.write("\u0015")
  view.stdin.write("/thinking ")
  await tick();await tick()
  assert.match(view.lastFrame()??"",/auto.*当前思考模式/)
  assert.match(view.lastFrame()??"",/off.*关闭思考/)
  view.stdin.write("off\r")
  await tick();await tick()
  assert.equal(selectedThinking,"off")
  assert.match(view.lastFrame()??"",/思考模式：off/)
  view.unmount()
})

test("resuming a session restores conversation and read-only tool history without replaying tools", async () => {
  const model: ChatModel = { async complete() { return { content: "done", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const messages: Message[] = [
    { role: "system", content: "system instructions" },
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "I will inspect it.", tool_calls: [{ id: "tool_1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "src/main.ts" }) } }] },
    { role: "tool", tool_call_id: "tool_1", content: "OK: SECRET HISTORICAL TOOL OUTPUT" },
    { role: "assistant", content: "Earlier answer" },
  ]
  const events = [
    { createdAt: "2026-08-07T00:00:00.000Z", event: { protocolVersion: 1, turnId: "turn_old", type: "turn.started", input: "Earlier question" } },
    { createdAt: "2026-08-07T00:00:00.500Z", event: { protocolVersion: 1, turnId: "turn_old", type: "approval.resolved", step: 1, callId: "approved_tool", name: "read_file", approved: true, choice: "session" } },
    { createdAt: "2026-08-07T00:00:01.000Z", event: { protocolVersion: 1, turnId: "turn_old", type: "tool.started", step: 1, callId: "tool_1", name: "read_file", args: { path: "src/main.ts" } } },
    { createdAt: "2026-08-07T00:00:02.000Z", event: { protocolVersion: 1, turnId: "turn_old", type: "tool.completed", step: 1, callId: "tool_1", name: "read_file", ok: true, output: "SECRET HISTORICAL TOOL OUTPUT" } },
    { createdAt: "2026-08-07T00:00:02.500Z", event: { protocolVersion: 1, turnId: "turn_old", type: "approval.resolved", step: 2, callId: "denied_tool", name: "shell", approved: false, choice: "deny" } },
    { createdAt: "2026-08-07T00:00:02.600Z", event: { protocolVersion: 1, turnId: "turn_old", type: "tool.started", step: 2, callId: "plan_1", name: "exit_plan_mode", args: { title: "Safe refactor", summary: "Split the module without changing behavior.", steps: ["Extract helpers", "Run tests"], files: ["src/main.ts"], verification: ["npm test"], risks: ["Import paths"] } } },
    { createdAt: "2026-08-07T00:00:02.700Z", event: { protocolVersion: 1, turnId: "turn_old", type: "tool.completed", step: 2, callId: "plan_1", name: "exit_plan_mode", ok: true, output: "Plan approved." } },
    { createdAt: "2026-08-07T00:00:03.000Z", event: { protocolVersion: 1, turnId: "turn_old", type: "turn.completed", output: "Earlier answer" } },
  ]
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_current", restored: false, initialMessages: [], conversation,
    approvalBridge: new ApprovalBridge(), attachEventSink: () => {}, runShellShortcut: async () => ({ ok: true, output: "" }),
    listSessions: async () => [{ id: "session_old", title: "Old work", workspace: process.cwd(), updatedAt: new Date().toISOString(), directory: "/tmp/session_old" }],
    resumeSession: async () => ({ session: { id: "session_old", title: "Old work", workspace: process.cwd(), updatedAt: new Date().toISOString(), directory: "/tmp/session_old" }, messages, events }),
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  view.stdin.write("/resu")
  await tick()
  view.stdin.write("\r")
  await tick()
  assert.match(view.lastFrame() ?? "", /Resume a previous session/)
  view.stdin.write("\r")
  await tick()
  await tick()
  const frame = view.lastFrame() ?? ""
  assert.match(frame, /Resumed session: Old work/)
  assert.match(frame, /Restored 2\/2 conversation messages/)
  assert.match(frame, /1 historical tool action/)
  assert.match(frame, /Earlier question/)
  assert.match(frame, /Earlier answer/)
  assert.doesNotMatch(frame, /I will inspect it/)
  assert.match(frame, /Explored/)
  assert.match(frame, /Read src\/main\.ts/)
  assert.doesNotMatch(frame, /Permission granted/)
  assert.match(frame, /Permission denied for shell/)
  assert.match(frame, /Safe refactor/)
  assert.match(frame, /Split the module without changing behavior/)
  assert.match(frame, /1\. Extract helpers/)
  assert.match(frame, /Files/)
  assert.match(frame, /`src\/main\.ts`/)
  assert.doesNotMatch(frame, /Plan approved/)
  assert.doesNotMatch(frame, /SECRET HISTORICAL TOOL OUTPUT/)
  view.stdin.write("\u000f")
  await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /SECRET HISTORICAL TOOL OUTPUT/, "Ctrl+O no longer reveals raw historical output")
  view.unmount()
})

test("composer stays visible while running and queues the next prompt", async () => {
  let finishFirst: (() => void) | undefined
  let requests = 0
  const model: ChatModel = {
    async complete() {
      requests++
      if (requests === 1) await new Promise<void>((resolve) => { finishFirst = resolve })
      return { content: requests === 1 ? "first done" : "second done", toolCalls: [] }
    },
  }
  let sink: ((event: AgentEvent) => void) | null = null
  const reports: Array<{ operation: string; category?: string }> = []
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false, onEvent: (event) => sink?.(event) })
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_test", restored: false, initialMessages: [], conversation,
    modelPresets: ["test-model", "other-model"],
    switchModel: async (preset) => ({ source: "config", sourceLabel: "test", preset, provider: "test", modelId: preset, baseUrl: "https://example.com/v1", apiKey: "test" }),
    approvalBridge: new ApprovalBridge(), attachEventSink: (next) => { sink = next }, runShellShortcut: async () => ({ ok: true, output: "" }),
    listSessions: async () => [], resumeSession: async () => { throw new Error("unused") }, renameCurrentSession: async () => { throw new Error("unused") },
    exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async (_error, operation, category) => { reports.push({ operation, ...(category ? { category } : {}) }); return { id: "err_20260806_12345678", file: "/tmp/error.json" } },
  }
  const view = render(React.createElement(ChatApp, props))
  await tick()
  const activeSink = sink as ((event: AgentEvent) => void) | null
  assert.ok(activeSink)
  const longToolOutput = ["summary line", "hidden detail line", ...Array.from({ length: 38 }, (_, index) => `detail-line-${index + 3}`)].join("\n")
  activeSink({ protocolVersion: 1, turnId: "turn_test", type: "tool.completed", step: 1, callId: "tool_test", name: "read_file", ok: true, output: longToolOutput })
  activeSink({ protocolVersion: 1, turnId: "turn_test", type: "step.started", step: 2 })
  await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /Ctrl\+O|tool details/)
  assert.doesNotMatch(view.lastFrame() ?? "", /hidden detail line/)
  view.stdin.write("\u000f")
  await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /hidden detail line/, "Ctrl+O should be inert after removing raw details")
  view.stdin.write("/")
  await tick()
  for (let index = 0; index < 7; index++) view.stdin.write("\u001B[B")
  await tick()
  assert.match(view.lastFrame() ?? "", /› \/restore/)
  assert.doesNotMatch(view.lastFrame() ?? "", /\/help  Show available commands/)
  view.stdin.write("\u0015")
  await tick()
  view.stdin.write("/")
  await tick()
  view.stdin.write("\u001B[B")
  view.stdin.write("\u001B[B")
  view.stdin.write("\r")
  await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /Show or switch model presets/)
  assert.match(view.lastFrame() ?? "", /\/model/)
  assert.match(view.lastFrame() ?? "", /other-model/)
  assert.equal(requests, 0)
  view.stdin.write("\u001B[B")
  view.stdin.write("\r")
  await tick()
  await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /Switched model: other-model/)
  view.stdin.write("\u001b[Z")
  await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /Entered read-only plan mode|approval mode remains/)
  assert.match(view.lastFrame() ?? "", /other-model · default · 0%.*Plan/)
  await tick()

  view.stdin.write("first\r")
  await tick()
  assert.match(view.lastFrame() ?? "", /Current task is running/)
  assert.match(view.lastFrame() ?? "", /other-model · default · 0%.*Plan/)
  view.stdin.write("\u001b[Z")
  await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /Exited plan mode|approval mode remains|other-model · default · 0%.*Plan/)
  view.stdin.write("/permissions\r")
  await tick()
  assert.match(view.lastFrame() ?? "", /Update Model Permissions/)
  view.stdin.write("\u001B[B")
  view.stdin.write("\u001B[B")
  view.stdin.write("\r")
  await tick()
  assert.match(view.lastFrame() ?? "", /Approval mode: full-access/)
  assert.match(view.lastFrame() ?? "", /other-model · default · 0%/)
  assert.match(view.lastFrame() ?? "", /Thinking/)
  assert.doesNotMatch(view.lastFrame() ?? "", /Thinking step|step 1/)
  const thinkingLines = (view.lastFrame() ?? "").split("\n")
  const thinkingLine = thinkingLines.findIndex((line) => line.includes("Thinking"))
  assert.ok(thinkingLine > 0 && thinkingLines[thinkingLine - 1]?.trim() === "", "thinking status should be separated from generated content")
  const runningLines = (view.lastFrame() ?? "").split("\n")
  const promptLine = runningLines.findIndex((line) => line.includes("Current task is running"))
  const statusLine = runningLines.findIndex((line) => line.includes("other-model · default · 0%"))
  assert.ok(promptLine >= 0 && statusLine - promptLine >= 2, "composer should reserve at least two input rows before the status line")

  view.stdin.write("/")
  await tick()
  assert.match(view.lastFrame() ?? "", /\/help  Show available commands/)
  assert.match(view.lastFrame() ?? "", /other-model · default · 0%/)
  view.stdin.write("\u0015")
  await tick()
  view.stdin.write("/status\r")
  await tick()
  await tick()
  assert.match(view.frames.join("\n"), /Workspace:/)
  assert.match(view.lastFrame() ?? "", /Current task is running/)
  assert.doesNotMatch(view.lastFrame() ?? "", /1 queued/)

  view.stdin.write("\u000f")
  await tick()
  assert.doesNotMatch(currentScreen(view.lastFrame() ?? ""), /hidden detail line/, "raw tool output should remain hidden")
  await new Promise((resolve) => setTimeout(resolve, 240))
  assert.doesNotMatch(currentScreen(view.lastFrame() ?? ""), /hidden detail line/)

  view.stdin.write("follow up\r")
  await tick()
  assert.match(view.lastFrame() ?? "", /1 queued/)
  assert.match(view.lastFrame() ?? "", /follow up/)

  finishFirst?.()
  await tick()
  await tick()
  assert.equal(requests, 2)
  view.stdin.write("/bug 回答结果不正确\r")
  await tick()
  assert.match(view.frames.join("\n"), /err_20260806_12345678/)
  assert.deepEqual(reports.at(-1), { operation: "interactive.bad_case", category: "bad_case" })
  view.unmount()
})

test("completed edit batches keep large diffs out of the animated pending region", async () => {
  const model: ChatModel = { async complete() { return { content: "done", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  let sink: ((event: AgentEvent) => void) | null = null
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_static_edits", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(),
    attachEventSink: (next) => { sink = next }, runShellShortcut: async () => ({ ok: true, output: "" }),
    listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  await tick()
  const activeSink = sink as ((event: AgentEvent) => void) | null
  assert.ok(activeSink)

  activeSink({ protocolVersion: 1, turnId: "turn_test", type: "tool.started", step: 1, callId: "edit_a", name: "edit_file", args: { path: "src/a.ts", old_text: "old-a", new_text: "new-a" } })
  activeSink({ protocolVersion: 1, turnId: "turn_test", type: "tool.completed", step: 1, callId: "edit_a", name: "edit_file", ok: true, output: "Edited src/a.ts" })
  activeSink({ protocolVersion: 1, turnId: "turn_test", type: "tool.started", step: 1, callId: "edit_b", name: "edit_file", args: { path: "src/b.ts", old_text: "old-b", new_text: "new-b" } })
  activeSink({ protocolVersion: 1, turnId: "turn_test", type: "tool.completed", step: 1, callId: "edit_b", name: "edit_file", ok: true, output: "Edited src/b.ts" })
  await tick()

  assert.match(view.lastFrame() ?? "", /Edited 2 files \(\+2 -2\)/)
  assert.doesNotMatch(view.lastFrame() ?? "", /new-a|new-b/, "pending edit batches should render only a compact summary")

  activeSink({ protocolVersion: 1, turnId: "turn_test", type: "step.started", step: 2 })
  await tick()
  const frozenFrame = view.lastFrame() ?? ""
  assert.match(frozenFrame, /Edited 2 files \(\+2 -2\)/)
  assert.match(frozenFrame, /new-a/)
  assert.match(frozenFrame, /new-b/)
  view.unmount()
})
