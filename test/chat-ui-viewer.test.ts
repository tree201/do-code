import assert from "node:assert/strict"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { Box } from "ink"
import { AgentConversation } from "../src/agent.js"
import type { AgentEvent, ChatModel } from "../src/protocol.js"
import { ApprovalBridge, boundedLiveOutput, ChatApp, inlineViewerHeight, TranscriptBlock, TranscriptLine, TranscriptViewer, transcriptViewerText, type ChatAppProps, type TranscriptItem } from "../src/ui/chat-app.js"
import { tick, waitForFrame } from "./support/chat-ui.js"

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

test("message viewer merges static streaming fragments into one assistant message", () => {
  const items: TranscriptItem[] = [
    { id: 1, kind: "assistant", text: "# Result\n\n", streamGroup: 7 },
    { id: 2, kind: "assistant", text: "First paragraph.\n\n", streamGroup: 7, continuation: true },
    { id: 3, kind: "assistant", text: "Final paragraph.", streamGroup: 7, continuation: true },
  ]
  const transcript = transcriptViewerText(items, "en")
  assert.equal(transcript.match(/• do-code/g)?.length, 1)
  assert.match(transcript, /# Result\n\nFirst paragraph\.\n\nFinal paragraph\./)
})

test("assistant streaming fragments preserve exactly one source blank line", () => {
  const first = render(React.createElement(TranscriptLine, {
    item: { id: 1, kind: "assistant", text: "### 验证结果\n", streamGroup: 4 },
    width: 80,
    language: "zh",
  })).lastFrame() ?? ""
  const second = render(React.createElement(TranscriptLine, {
    item: { id: 2, kind: "assistant", text: "1. 第一项\n   - 子项一\n   - 子项二\n\n", streamGroup: 4, continuation: true },
    width: 80,
    language: "zh",
  })).lastFrame() ?? ""
  assert.equal(first.split("\n").filter((line) => !line.trim()).length, 0)
  assert.equal(second.split("\n").filter((line) => !line.trim()).length, 1)
})

test("streaming assistant leaves exactly one message row before a following tool activity", () => {
  const renderBoundary = (text: string) => {
    const assistant = { id: 1, kind: "assistant" as const, text, streamGroup: 4, continuation: true }
    const tool = {
      id: 2,
      kind: "tool" as const,
      tools: [{
        name: "shell",
        args: { command: "gcc hello.c -o hello && ./hello" },
        ok: true,
        output: "Hello, world!",
        presentation: { kind: "command" as const, command: "gcc hello.c -o hello && ./hello", excerpt: ["Hello, world!"] },
      }],
    }
    const view = render(React.createElement(Box, { flexDirection: "column", width: 100 },
      React.createElement(TranscriptBlock, { first: true }, React.createElement(TranscriptLine, { item: assistant, width: 100, language: "en" })),
      React.createElement(TranscriptBlock, null, React.createElement(TranscriptLine, { item: tool, width: 100, language: "en" })),
    ))
    const lines = (view.lastFrame() ?? "").split("\n")
    view.unmount()
    return lines
  }

  for (const text of ["程序正常退出。", "程序正常退出。\n\n", "程序正常退出。\n\n\n"]) {
    const lines = renderBoundary(text)
    const assistantLine = lines.findIndex((line) => line.includes("程序正常退出。"))
    const toolLine = lines.findIndex((line) => line.includes("Ran gcc hello.c -o hello"))
    assert.ok(assistantLine >= 0 && toolLine > assistantLine)
    assert.equal(lines[assistantLine + 1]?.trim(), "")
    assert.equal(toolLine, assistantLine + 2)
  }
})

test("assistant with trailing source spacing does not double-space an edit activity", () => {
  const assistant = { id: 1, kind: "assistant" as const, text: "我来帮你创建一个Java版本的Hello World程序。\n\n" }
  const tool = {
    id: 2,
    kind: "tool" as const,
    tools: [{
      name: "write_file",
      args: { path: "HelloWorld.java", content: "public class HelloWorld {}\n" },
      ok: true,
      output: "Wrote HelloWorld.java",
      presentation: { kind: "edit" as const, targets: ["HelloWorld.java"], fileChanges: [{ path: "HelloWorld.java", additions: 1, deletions: 0, diffLines: [{ kind: "add" as const, text: "public class HelloWorld {}", newLine: 1 }] }] },
    }],
  }
  const view = render(React.createElement(Box, { flexDirection: "column", width: 100 },
    React.createElement(TranscriptBlock, { first: true }, React.createElement(TranscriptLine, { item: assistant, width: 100, language: "en" })),
    React.createElement(TranscriptBlock, null, React.createElement(TranscriptLine, { item: tool, width: 100, language: "en" })),
  ))
  const lines = (view.lastFrame() ?? "").split("\n")
  const assistantLine = lines.findIndex((line) => line.includes("我来帮你创建一个Java版本"))
  const toolLine = lines.findIndex((line) => line.includes("Edited HelloWorld.java"))
  assert.ok(assistantLine >= 0 && toolLine > assistantLine)
  assert.equal(lines[assistantLine + 1]?.trim(), "")
  assert.equal(toolLine, assistantLine + 2)
  view.unmount()
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
  const viewerFrame = await waitForFrame(view, /Message viewer/)
  assert.match(viewerFrame, /Message viewer/)
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

test("streaming markdown freezes stable blocks and keeps one logical answer in Ctrl+T", async () => {
  let finishModel: (() => void) | undefined
  const model: ChatModel = { async complete() {
    await new Promise<void>((resolve) => { finishModel = resolve })
    return { content: "# Result\n\nStable paragraph.\n\nPending tail", toolCalls: [] }
  } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  let sink: ((event: AgentEvent) => void) | null = null
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_streaming_markdown", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(), attachEventSink: (next) => { sink = next },
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [],
    resumeSession: async () => { throw new Error("unused") }, renameCurrentSession: async () => { throw new Error("unused") },
    exportCurrentSession: async () => "unused", save: async () => {}, reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  await tick()
  view.stdin.write("stream markdown\r")
  await tick()
  const activeSink = sink as ((event: AgentEvent) => void) | null
  assert.ok(activeSink)
  activeSink({ protocolVersion: 1, turnId: "turn_stream", type: "message.delta", step: 1, delta: "# Result\n\nStable paragraph.\n\nPending tail" })
  await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /Result/)
  assert.match(view.lastFrame() ?? "", /Stable paragraph\./)
  assert.match(view.lastFrame() ?? "", /Pending tail/)

  activeSink({ protocolVersion: 1, turnId: "turn_stream", type: "turn.completed", output: "# Result\n\nStable paragraph.\n\nPending tail" })
  finishModel?.()
  await tick(); await tick()
  view.stdin.write("\u0014")
  await tick(); await tick()
  const frame = view.lastFrame() ?? ""
  assert.match(frame, /# Result/)
  assert.match(frame, /Stable paragraph\./)
  assert.match(frame, /Pending tail/)
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
