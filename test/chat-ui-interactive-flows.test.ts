import assert from "node:assert/strict"
import { stripVTControlCharacters } from "node:util"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { AgentConversation } from "../src/agent.js"
import type { AgentEvent, ChatModel } from "../src/protocol.js"
import { ApprovalBridge, ChatApp, type ChatAppProps } from "../src/ui/chat-app.js"
import { currentScreen, tick } from "./support/chat-ui.js"

test("composer stays visible while running and queues the next prompt", async (t) => {
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
  t.after(() => {
    finishFirst?.()
    view.unmount()
  })
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
  view.stdin.write("/rew")
  await tick()
  assert.match(view.lastFrame() ?? "", /› \/rewind/)
  assert.doesNotMatch(view.lastFrame() ?? "", /\/help  Show available commands/)
  view.stdin.write("\u0015")
  await tick()
  view.stdin.write("/model\r")
  await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /other-model/)
  assert.equal(requests, 0)
  view.stdin.write("\u001B[B")
  await tick()
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
  assert.doesNotMatch(view.lastFrame() ?? "", /Approval mode: full-access/)
  assert.match(view.lastFrame() ?? "", /other-model · default · 0% · full-access/)
  assert.match(view.lastFrame() ?? "", /Thinking/)
  assert.doesNotMatch(view.lastFrame() ?? "", /Thinking step|step 1/)
  const thinkingLines = stripVTControlCharacters(view.lastFrame() ?? "").split("\n")
  const thinkingLine = thinkingLines.findIndex((line) => line.includes("Thinking"))
  const runningPromptLine = thinkingLines.findIndex((line) => line.includes("Current task is running"))
  const modelStatusLine = thinkingLines.findIndex((line) => line.includes("other-model · default · 0%"))
  assert.equal(thinkingLines[thinkingLine + 1]?.trim(), "", "the composer should keep its top padding row")
  assert.equal(runningPromptLine, thinkingLine + 2, "the single input row should follow the top padding")
  assert.equal(thinkingLines[runningPromptLine + 1]?.trim(), "", "the composer should keep its bottom padding row")
  assert.equal(modelStatusLine, runningPromptLine + 2, "the model status should render below the padded composer")
  assert.doesNotMatch(thinkingLines.slice(thinkingLine, modelStatusLine + 1).join("\n"), /─/)

  view.stdin.write("/")
  await tick()
  const completionFrame = stripVTControlCharacters(view.lastFrame() ?? "")
  assert.match(completionFrame, /\/help  Show available commands/)
  assert.match(completionFrame, /other-model · default · 0%/)
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
  const queuedLines = stripVTControlCharacters(view.lastFrame() ?? "").split("\n")
  const queuedThinkingLine = queuedLines.findIndex((line) => line.includes("Thinking"))
  const queuedStatusLine = queuedLines.findIndex((line) => line.includes("1 queued"))
  const queuedMessageLine = queuedLines.findIndex((line) => line.includes("1. follow up"))
  const queuedInputLine = queuedLines.findIndex((line) => line.includes("Current task is running"))
  const queuedModelLine = queuedLines.findIndex((line) => line.includes("other-model · default · 0%"))
  assert.ok(queuedThinkingLine < queuedStatusLine)
  assert.equal(queuedMessageLine, queuedStatusLine + 1)
  assert.ok(queuedMessageLine < queuedInputLine)
  assert.ok(queuedInputLine < queuedModelLine)
  assert.doesNotMatch(queuedLines.slice(queuedStatusLine, queuedInputLine).join("\n"), /•/)

  view.stdin.write("\u001B[A")
  await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /1 queued/)
  assert.match(view.lastFrame() ?? "", /follow up/)
  view.stdin.write("\r")
  await tick()
  assert.match(view.lastFrame() ?? "", /1 queued/)

  finishFirst?.()
  await tick()
  await tick()
  assert.equal(requests, 2)
  view.stdin.write("/bug 回答结果不正确\r")
  await tick()
  assert.match(view.frames.join("\n"), /err_20260806_12345678/)
  assert.deepEqual(reports.at(-1), { operation: "interactive.bad_case", category: "bad_case" })
})

test("tool activity owns its leading row after an assistant was already frozen", async () => {
  let finishModel: (() => void) | undefined
  const model: ChatModel = { async complete() {
    await new Promise<void>((resolve) => { finishModel = resolve })
    return { content: "Final answer", toolCalls: [] }
  } }
  let sink: ((event: AgentEvent) => void) | null = null
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_tool_spacing", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(), attachEventSink: (next) => { sink = next },
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [],
    resumeSession: async () => { throw new Error("unused") }, renameCurrentSession: async () => { throw new Error("unused") },
    exportCurrentSession: async () => "unused", save: async () => {}, reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  await tick()
  view.stdin.write("verify spacing\r")
  await tick()
  const activeSink = sink as ((event: AgentEvent) => void) | null
  assert.ok(activeSink)
  activeSink({ protocolVersion: 1, turnId: "turn_spacing", type: "message.delta", step: 1, delta: "The source is ready.\n\n" })
  activeSink({ protocolVersion: 1, turnId: "turn_spacing", type: "tool.started", step: 1, callId: "shell_spacing", name: "shell", args: { command: "g++ hello.cpp -o hello_cpp && ./hello_cpp" } })
  await tick(); await tick()
  activeSink({ protocolVersion: 1, turnId: "turn_spacing", type: "tool.completed", step: 1, callId: "shell_spacing", name: "shell", ok: true, output: "Hello, World!" })
  activeSink({ protocolVersion: 1, turnId: "turn_spacing", type: "step.started", step: 2 })
  await tick(); await tick()

  const lines = (view.lastFrame() ?? "").split("\n")
  const assistantLine = lines.findIndex((line) => line.includes("The source is ready."))
  const toolLine = lines.findIndex((line) => line.includes("Ran g++ hello.cpp -o hello_cpp"))
  assert.ok(assistantLine >= 0 && toolLine > assistantLine)
  assert.equal(lines[assistantLine + 1]?.trim(), "")
  assert.equal(toolLine, assistantLine + 2)
  finishModel?.()
  await tick(); await tick()
  view.unmount()
})

test("Ctrl+C clears a draft before arming exit confirmation", async () => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_exit_confirmation", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [],
    resumeSession: async () => { throw new Error("unused") }, renameCurrentSession: async () => { throw new Error("unused") },
    exportCurrentSession: async () => "unused", save: async () => {}, reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  await tick()
  view.stdin.write("draft")
  await tick()
  view.stdin.write("\u001b[99;5u")
  await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /draft|\[99;5u/)
  assert.doesNotMatch(view.lastFrame() ?? "", /Press Ctrl\+C again to exit/)
  view.stdin.write("\u001b[99;5u")
  await tick()
  assert.match(view.lastFrame() ?? "", /Press Ctrl\+C again to exit/)
  view.unmount()
})

test("Ctrl+Enter inserts a composer newline without submitting", async () => {
  let requests = 0
  const model: ChatModel = { async complete() { requests++; return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_multiline", restored: false,
    initialMessages: [], conversation, language: "zh", approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [],
    resumeSession: async () => { throw new Error("unused") }, renameCurrentSession: async () => { throw new Error("unused") },
    exportCurrentSession: async () => "unused", save: async () => {}, reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  await tick()
  view.stdin.write("first line")
  view.stdin.write("\u001b[13;5u")
  view.stdin.write("second line")
  await tick()
  const frame = view.lastFrame() ?? ""
  assert.match(frame, /first line/)
  assert.match(frame, /second line/)
  assert.ok(frame.indexOf("second line") > frame.indexOf("first line"))
  assert.equal(requests, 0)
  view.unmount()
})
