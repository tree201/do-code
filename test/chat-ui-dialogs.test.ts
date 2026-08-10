import assert from "node:assert/strict"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { Box, Text } from "ink"
import { AgentConversation } from "../src/agent.js"
import type { ChatModel } from "../src/protocol.js"
import { ApprovalBridge, ApprovalDialog, askAnswerPairs, ChatApp, PermissionModeDialog, PlanReviewBridge, PlanReviewDialog, QuestionBridge, QuestionDialog, TranscriptLine, planMarkdown, type ChatAppProps } from "../src/ui/chat-app.js"
import { DialogManager, DialogSurface } from "../src/ui/components/dialog-manager.js"
import { displayWidth } from "../src/ui/terminal-text.js"
import { tick } from "./support/chat-ui.js"

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
  assert.doesNotMatch(frame, /拆分认证模块/)
  assert.doesNotMatch(frame, /完整计划已写入上方对话历史/)
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
  const transcriptLines = transcriptFrame.split("\n")
  const titleLine = transcriptLines.findIndex((line) => line.includes("拆分认证模块"))
  const verificationLine = transcriptLines.findIndex((line) => line.includes("npm test"))
  assert.equal(transcriptLines[titleLine - 1]?.trim(), "", "plan content should have one row of top padding")
  assert.equal(transcriptLines[verificationLine + 1]?.trim(), "", "plan content should have one row of bottom padding")
  transcript.unmount()
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
  assert.doesNotMatch(frame, /思考中/, "the animated spinner must be unmounted while plan review waits")
  await new Promise((resolve) => setTimeout(resolve, 160))
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
