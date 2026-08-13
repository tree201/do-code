import assert from "node:assert/strict"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { Box, Text } from "ink"
import { AgentConversation } from "../src/agent.js"
import type { ChatModel } from "../src/protocol.js"
import { ApprovalBridge, ApprovalDialog, askAnswerPairs, ChatApp, PermissionModeDialog, PlanPublisherBridge, QuestionBridge, QuestionDialog, TranscriptLine, planMarkdown, type ChatAppProps } from "../src/ui/chat-app.js"
import { DialogManager, DialogSurface } from "../src/ui/components/dialog-manager.js"
import { displayWidth } from "../src/ui/terminal-text.js"
import { tick, visibleFrame } from "./support/chat-ui.js"

test("transient dialogs share one responsive control surface", (t) => {
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
  t.after(() => view.unmount())
  const frame = visibleFrame(view)
  assert.match(frame, /需要批准这个操作/)
  assert.ok(frame.split("\n").every((line) => displayWidth(line) <= width))
})

test("agent questions separate title, prompt, options, and localized controls", (t) => {
  const view = render(React.createElement(Box, { width: 60 }, React.createElement(QuestionDialog, {
    question: "你希望主要优化哪个方向？",
    options: ["代码结构重构", "运行性能优化", "打包体积优化"],
    selectedIndex: 1,
    draft: "",
    customAnswer: false,
    language: "zh",
  })))
  t.after(() => view.unmount())
  const lines = visibleFrame(view).split("\n")
  const title = lines.findIndex((line) => line.includes("需要你的输入"))
  const prompt = lines.findIndex((line) => line.includes("你希望主要优化哪个方向"))
  const firstOption = lines.findIndex((line) => line.includes("代码结构重构"))
  const controls = lines.findIndex((line) => line.includes("Enter 确认"))
  assert.ok(title >= 0 && prompt >= title + 2, "title and question should be visually separated")
  assert.ok(firstOption >= prompt + 2, "question and options should be visually separated")
  assert.ok(controls >= firstOption + 4, "controls should be visually separated from the option list")
  assert.ok(lines.every((line) => displayWidth(line) <= 60))
})

test("new locales translate common question dialogs", (t) => {
  const cases = [
    ["ja", "入力が必要です"],
    ["ko", "입력이 필요합니다"],
    ["es", "El agente necesita tu respuesta"],
    ["fr", "L’agent a besoin de votre réponse"],
  ] as const
  for (const [language, questionTitle] of cases) {
    const question = render(React.createElement(QuestionDialog, { question: "Choose", options: ["One"], selectedIndex: 0, draft: "", customAnswer: false, language }))
    t.after(() => question.unmount())
    assert.match(visibleFrame(question), new RegExp(questionTitle))
  }
})

test("file approval uses a localized restrained Codex-style diff", (t) => {
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
  t.after(() => view.unmount())
  const frame = visibleFrame(view)
  assert.match(frame, /修改 src\/earth\.js  中等风险/)
  assert.match(frame, /- earthSystem\.add\(nightLights\)/)
  assert.match(frame, /\+ earth\.add\(nightLights\)/)
  assert.match(frame, /允许修改这个文件吗/)
  assert.match(frame, /› 1\. 允许一次/)
  assert.match(frame, /3\. 始终允许此操作/)
  assert.doesNotMatch(frame, /Original|Updated|legacy raw detail|mode\.default/)
  assert.ok(frame.split("\n").every((line) => displayWidth(line) <= 72))
})

test("plans render directly in the transcript", (t) => {
  const plan = {
    title: "拆分认证模块",
    summary: "保持行为兼容，拆分策略与传输层。",
    steps: ["提取策略", "迁移调用方", "运行回归测试"],
    files: ["src/auth.ts", "test/auth.test.ts"],
    verification: ["npm test"],
    risks: ["会话兼容性"],
  }
  const transcript = render(React.createElement(TranscriptLine, {
    item: { id: 99, kind: "plan", plan },
    width: 80,
    language: "zh",
  }))
  t.after(() => transcript.unmount())
  const transcriptFrame = visibleFrame(transcript)
  assert.match(transcriptFrame, /1\. 提取策略/)
  assert.match(transcriptFrame, /src\/auth\.ts/)
  assert.match(transcriptFrame, /npm test/)
  const transcriptLines = transcriptFrame.split("\n")
  const titleLine = transcriptLines.findIndex((line) => line.includes("拆分认证模块"))
  const verificationLine = transcriptLines.findIndex((line) => line.includes("npm test"))
  assert.equal(transcriptLines[titleLine - 1]?.trim(), "", "plan content should have one row of top padding")
  assert.equal(transcriptLines[verificationLine + 1]?.trim(), "", "plan content should have one row of bottom padding")
})

test("plan markdown preserves structured steps without duplicate numbering", () => {
  const markdown = planMarkdown({
    title: "性能优化",
    summary: "减少后台开销。",
    steps: [
      "1. 渲染循环优化：在 main.js 中实现智能启停机制",
      "- 监听 visibilitychange：页面隐藏时停止 RAF 循环",
      "- 计算是否需要持续渲染条件",
      "2. GPU 资源释放：建立完整的 dispose 链",
      "- earth.js：增加 disposeEarthSystem()",
    ],
  }, "zh")
  assert.match(markdown, /### 1\. 渲染循环优化/)
  assert.match(markdown, /- 监听 visibilitychange/)
  assert.match(markdown, /### 2\. GPU 资源释放/)
  assert.doesNotMatch(markdown, /### 1\. 1\./)
  assert.doesNotMatch(markdown, /### 2\. -/)
})

test("published plans enter scrollback without opening a review dialog", async (t) => {
  const model: ChatModel = { async complete() { return { content: "done", toolCalls: [] } } }
  const planPublisher = new PlanPublisherBridge()
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_plan_scroll", restored: false,
    initialMessages: [], conversation, language: "zh", approvalBridge: new ApprovalBridge(), planPublisher,
    attachEventSink: () => {}, runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [],
    resumeSession: async () => { throw new Error("unused") }, renameCurrentSession: async () => { throw new Error("unused") },
    exportCurrentSession: async () => "unused", save: async () => {}, reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  t.after(() => view.unmount())
  planPublisher.publish({
    title: "长计划滚动回归",
    summary: "计划正文必须进入稳定的终端历史。",
    steps: Array.from({ length: 30 }, (_, index) => `步骤 ${index + 1}`),
    files: [], verification: ["npm test"], risks: [],
  })
  await tick()
  const frame = visibleFrame(view)
  assert.match(frame, /步骤 30/)
  assert.doesNotMatch(frame, /Proposed Plan/)
  assert.match(frame, /test-model · 默认 · 0% · ask/)
})

test("permission menu presents the three real do-code approval levels", (t) => {
  const view = render(React.createElement(PermissionModeDialog, {
    currentMode: "full-access",
    selectedIndex: 0,
    language: "zh",
  }))
  t.after(() => view.unmount())
  const frame = visibleFrame(view)
  assert.match(frame, /更新模型权限/)
  assert.match(frame, /请求批准/)
  assert.match(frame, /自动批准安全操作/)
  assert.match(frame, /完全访问（当前）/)
  assert.match(frame, /工作区外文件/)
})

test("agent interactions record the question before the answer without exposing ask_user", async (t) => {
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
  t.after(() => view.unmount())
  await tick()
  const pendingAnswer = questionBridge.request("[Direction] Choose one", ["Structure", "Performance", "Other — Enter a different answer"])
  await tick()
  view.stdin.write("\u001b[B")
  await tick()
  view.stdin.write("\u001b[B")
  await tick()
  view.stdin.write("\r")
  await tick()
  assert.match(visibleFrame(view), /Type an answer · Enter Send · Esc Back/)
  view.stdin.write("Accessibility")
  view.stdin.write("\r")
  assert.equal(await pendingAnswer, "Accessibility")
  await tick()
  const frame = visibleFrame(view)
  assert.equal(frame.match(/Ask: \[Direction\] Choose one/g)?.length, 1)
  assert.equal(frame.match(/Answer: Accessibility/g)?.length, 1)
  assert.ok(frame.indexOf("Ask: [Direction] Choose one") < frame.indexOf("Answer: Accessibility"))
  assert.doesNotMatch(frame, /ask_user/)
})

test("Enter submits an effort completion and opens the effort dialog", async (t) => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_effort_completion", restored: false,
    initialMessages: [], conversation, language: "en", reasoningEffort: "medium", approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    switchEffort: async (effort) => ({ source: "config", sourceLabel: "test", preset: "test-model", provider: "test", modelId: "test-model", baseUrl: "https://example.com/v1", apiKey: "test", reasoningEffort: effort }),
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [],
    resumeSession: async () => { throw new Error("unused") }, renameCurrentSession: async () => { throw new Error("unused") },
    exportCurrentSession: async () => "unused", save: async () => {}, reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  t.after(() => view.unmount())
  await tick()
  view.stdin.write("/eff")
  await tick()
  assert.match(visibleFrame(view), /› \/effort/)
  view.stdin.write("\r")
  await tick()
  assert.match(visibleFrame(view), /Select Reasoning Effort/)
})
