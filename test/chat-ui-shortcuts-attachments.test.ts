import assert from "node:assert/strict"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { AgentConversation } from "../src/agent.js"
import { classifyPastedImagePaths } from "../src/image-attachments.js"
import type { ChatModel } from "../src/protocol.js"
import { ApprovalBridge, ChatApp, HelpDialog, isHelpShortcut, isReasoningEffortShortcut, nextReasoningEffort, type ChatAppProps } from "../src/ui/chat-app.js"
import { tick, visibleFrame } from "./support/chat-ui.js"

test("reasoning effort shortcut cycles through the configured levels", () => {
  assert.equal(nextReasoningEffort("low"), "medium")
  assert.equal(nextReasoningEffort("medium"), "high")
  assert.equal(nextReasoningEffort("high"), "xhigh")
  assert.equal(nextReasoningEffort("xhigh"), "max")
  assert.equal(nextReasoningEffort("max"), "low")
  assert.equal(nextReasoningEffort("default"), "low")
})

test("reasoning effort shortcut uses Ctrl+R without matching plain R", () => {
  assert.equal(isReasoningEffortShortcut("r", { ctrl: true }), true)
  assert.equal(isReasoningEffortShortcut("R", { ctrl: true }), true)
  assert.equal(isReasoningEffortShortcut("r", { ctrl: false }), false)
  assert.equal(isReasoningEffortShortcut("e", { ctrl: true }), false)
})

test("Ctrl+H is recognized from Ink's backspace key event", () => {
  assert.equal(isHelpShortcut("", { backspace: true }), true)
  assert.equal(isHelpShortcut("", { backspace: false }), false)
  assert.equal(isHelpShortcut("h", { backspace: true }), false)
})

test("help dialog renders localized shortcut content", (t) => {
  const zhView = render(React.createElement(HelpDialog, { language: "zh", width: 80, height: 24, offset: 0 }))
  const enView = render(React.createElement(HelpDialog, { language: "en", width: 80, height: 24, offset: 0 }))
  t.after(() => { zhView.unmount(); enView.unmount() })
  const zh = visibleFrame(zhView)
  const en = visibleFrame(enView)
  assert.match(zh, /快捷键与操作帮助/)
  assert.match(zh, /Ctrl\+R.*切换思考强度/)
  assert.match(en, /Keyboard shortcuts and help/)
  assert.match(en, /Ctrl\+R.*Cycle reasoning effort/)
})

test("interactive Ctrl+H opens and closes help without changing the draft", async () => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const view = render(React.createElement(ChatApp, {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_help", restored: false,
    initialMessages: [], conversation, approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  } satisfies ChatAppProps))
  view.stdin.write("draft")
  await tick(); await tick()
  view.stdin.write("\u0008")
  await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /Keyboard shortcuts and help/)
  view.stdin.write("\u0008")
  await tick(); await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /Keyboard shortcuts and help/)
  assert.match(view.lastFrame() ?? "", /draft/)
  view.stdin.write("\u007f")
  await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /draf/)
  assert.doesNotMatch(view.lastFrame() ?? "", /draft/)
  view.unmount()
})

test("interactive Ctrl+R switches effort while Ctrl+E keeps its editor behavior", async () => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const switched: string[] = []
  const view = render(React.createElement(ChatApp, {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_effort", restored: false,
    initialMessages: [], conversation, reasoningEffort: "low", approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    switchEffort: async (effort) => {
      switched.push(effort)
      return { source: "config", sourceLabel: "test", preset: "test-model", provider: "test", modelId: "test-model", baseUrl: "https://example.com", apiKey: "test", reasoningEffort: effort }
    },
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  } satisfies ChatAppProps))
  view.stdin.write("draft")
  await tick()
  view.stdin.write("\u0005")
  await tick()
  assert.deepEqual(switched, [])
  view.stdin.write("\u0012")
  await tick(); await tick()
  assert.deepEqual(switched, ["medium"])
  assert.doesNotMatch(view.lastFrame() ?? "", /Reasoning effort: medium/)
  view.unmount()
})

test("Ctrl+V keeps an image attachment separate from text and ignores leaked Enter", async () => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const view = render(React.createElement(ChatApp, {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_clipboard", restored: false,
    initialMessages: [], conversation, approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    pasteImage: async () => {
      await tick()
      return { reference: "attachments/image_clipboard.png", name: "image_clipboard.png", size: 100 }
    },
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  } satisfies ChatAppProps))
  view.stdin.write("draft")
  await tick()
  view.stdin.write("\u0016")
  await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /Importing clipboard image|Current task is running/)
  await tick(); await tick(); await tick(); await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /draft \[Image #1\]/)
  assert.doesNotMatch(view.lastFrame() ?? "", /draft @attachments\/image_clipboard\.png/)
  assert.doesNotMatch(view.lastFrame() ?? "", /\[1\] image_clipboard\.png/)
  view.stdin.write("\r")
  await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /draft \[Image #1\]/)
  view.stdin.write("继续")
  await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /draft \[Image #1\] 继续/)
  view.stdin.write("\u007f")
  await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /draft \[Image #1\] 继/)
  view.stdin.write("\u007f")
  await tick(); await tick()
  view.stdin.write("\u007f")
  await tick(); await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /\[Image #1\]/)
  assert.match(view.lastFrame() ?? "", /draft/)
  view.unmount()
})

test("pasted image paths support terminal path formats without swallowing mixed text", () => {
  assert.deepEqual(classifyPastedImagePaths("/tmp/Screen\\ Shot.png"), { imagePaths: ["/tmp/Screen Shot.png"], allImages: true })
  assert.deepEqual(classifyPastedImagePaths("@'/tmp/Screen Shot.png'"), { imagePaths: ["/tmp/Screen Shot.png"], allImages: true })
  assert.deepEqual(classifyPastedImagePaths("/tmp/one.png /tmp/two.jpg"), { imagePaths: ["/tmp/one.png", "/tmp/two.jpg"], allImages: true })
  assert.deepEqual(classifyPastedImagePaths("note /tmp/image.png"), { imagePaths: ["/tmp/image.png"], allImages: false })
  assert.deepEqual(classifyPastedImagePaths("/tmp/image.png\nnotes"), { imagePaths: ["/tmp/image.png"], allImages: false })
})
