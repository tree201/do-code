import assert from "node:assert/strict"
import { stripVTControlCharacters } from "node:util"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { AgentConversation } from "../src/agent.js"
import { classifyPastedImagePaths } from "../src/image-attachments.js"
import type { ChatModel } from "../src/protocol.js"
import { ApprovalBridge, ChatApp, HelpDialog, helpDialogLines, helpDialogRows, isHelpShortcut, isReasoningEffortShortcut, nextInteractionMode, nextReasoningEffort, type ChatAppProps } from "../src/ui/chat-app.js"
import { displayWidth } from "../src/ui/terminal-text.js"
import { tick, visibleFrame } from "./support/chat-ui.js"
import { createRuntimeStore } from "../src/ui/runtime-store.js"

test("reasoning effort shortcut cycles through the configured levels", () => {
  assert.equal(nextReasoningEffort("low"), "medium")
  assert.equal(nextReasoningEffort("medium"), "high")
  assert.equal(nextReasoningEffort("high"), "xhigh")
  assert.equal(nextReasoningEffort("xhigh"), "max")
  assert.equal(nextReasoningEffort("max"), "low")
  assert.equal(nextReasoningEffort("default"), "low")
})

test("interaction mode cycles Plan, Ask, Auto, and Full Access", () => {
  assert.equal(nextInteractionMode("plan"), "ask")
  assert.equal(nextInteractionMode("ask"), "auto")
  assert.equal(nextInteractionMode("auto"), "full-access")
  assert.equal(nextInteractionMode("full-access"), "plan")
})

test("reasoning effort shortcut uses Ctrl+R without matching plain R", () => {
  assert.equal(isReasoningEffortShortcut("r", { ctrl: true }), true)
  assert.equal(isReasoningEffortShortcut("R", { ctrl: true }), true)
  assert.equal(isReasoningEffortShortcut("r", { ctrl: false }), false)
  assert.equal(isReasoningEffortShortcut("e", { ctrl: true }), false)
})

test("runtime resume restores approval mode but leaves Plan mode under user control", async () => {
  const modelConfig = { source: "config" as const, sourceLabel: "test", preset: "test/a", provider: "test", modelId: "a", baseUrl: "https://example.com", apiKey: "hidden" }
  const session = { id: "session_a", workspace: "/tmp", model: "test/a", createdAt: "now", updatedAt: "now", directory: "/tmp/session_a" }
  const applied: string[] = []
  const plans: boolean[] = []
  const store = createRuntimeStore({ session, modelConfig, modelPresets: ["test/a"], approvalMode: "ask", planMode: false, language: "en" }, {
    setApprovalMode: (mode) => { applied.push(mode) },
    setPlanMode: (active) => { plans.push(active) },
    resumeSession: async (id) => ({ session: { ...session, id, ...(id === "saved" ? { approvalMode: "full-access" as const, planMode: true } : {}) }, messages: [], events: [] }),
  })
  await store.resumeSession("saved")
  assert.equal(store.getSnapshot().approvalMode, "full-access")
  assert.equal(store.getSnapshot().planMode, false)
  await store.resumeSession("legacy")
  assert.equal(store.getSnapshot().planMode, false)
  assert.deepEqual(applied, ["full-access", "full-access"])
  assert.deepEqual(plans, [false, false])
})

test("Ctrl+H is recognized from Ink's backspace key event", () => {
  assert.equal(isHelpShortcut("", { backspace: true }), true)
  assert.equal(isHelpShortcut("", { backspace: false }), false)
  assert.equal(isHelpShortcut("h", { backspace: true }), false)
})

test("help dialog uses two columns on wide terminals and one column when narrow", (t) => {
  const narrowView = render(React.createElement(HelpDialog, { language: "zh", width: 80, height: 24, offset: 0 }))
  const wideView = render(React.createElement(HelpDialog, { language: "zh", width: 160, height: 32, offset: 0 }))
  t.after(() => { narrowView.unmount(); wideView.unmount() })
  const narrow = visibleFrame(narrowView)
  const wide = visibleFrame(wideView)
  const narrowLines = helpDialogLines("zh", 80)
  const wideLines = helpDialogLines("zh", 160)
  const wideRows = helpDialogRows(32)
  assert.match(narrow, /快捷键与操作帮助/)
  assert.match(narrow, /常用命令/)
  assert.doesNotMatch(narrow, /常用命令.*会话与工作区/)
  assert.match(wide, new RegExp(`快捷键与操作帮助\\s+1-${wideLines.length}/${wideLines.length}`))
  assert.match(wide, /常用命令\s+会话与工作区/)
  assert.match(wide, /输入快捷方式/)
  assert.match(wide, /Ctrl\+Enter/)

  assert.equal(wideRows, 24)
  assert.ok(wideLines.some((line) => /常用命令\s+会话与工作区/.test(line)))
  assert.ok(wideLines.some((line) => /Ctrl\+Enter.*插入换行/.test(line)))
  assert.ok(wideLines.length < narrowLines.length)
  assert.ok(wideLines.length <= helpDialogRows(32))
  assert.ok(wideLines.every((line) => displayWidth(line) <= 156))
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
  assert.match(view.lastFrame() ?? "", /Common commands/)
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

test("interactive /help closes for a complete Kitty Escape sequence", async (t) => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const view = render(React.createElement(ChatApp, {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_slash_help", restored: false,
    initialMessages: [], conversation, approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  } satisfies ChatAppProps))
  t.after(() => view.unmount())
  view.stdin.write("/help\r")
  await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /Keyboard shortcuts and help/)
  assert.match(view.lastFrame() ?? "", /Common commands/)
  view.stdin.write("\u001b[27;1u")
  await tick(); await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /Keyboard shortcuts and help|Common commands/)
  assert.equal(conversation.history().length, 0)
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

test("effort default command persists without changing the current session", async () => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  let switched = false
  let persisted = ""
  const session = { id: "session_effort_default", workspace: process.cwd(), model: "test-model", createdAt: "now", updatedAt: "now", directory: "/tmp/session_effort_default" }
  const modelConfig = { source: "config" as const, sourceLabel: "test", preset: "test-model", provider: "test", modelId: "test-model", baseUrl: "https://example.com", apiKey: "test", reasoningEffort: "medium" as const }
  const runtimeStore = createRuntimeStore({ session, modelConfig, modelPresets: ["test-model"], approvalMode: "ask", planMode: false, language: "en" }, {
    switchEffort: async (effort) => { switched = true; return { ...modelConfig, reasoningEffort: effort } },
    persistDefaultReasoningEffort: async (effort) => { persisted = effort },
  })
  const view = render(React.createElement(ChatApp, {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: session.id, restored: false,
    initialMessages: [], conversation, runtimeStore, approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  } satisfies ChatAppProps))
  view.stdin.write("/effort default high\r")
  await tick(); await tick()
  assert.equal(switched, false)
  assert.equal(persisted, "high")
  assert.match(visibleFrame(view), /high is now the default reasoning effort/)
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
  assert.match(stripVTControlCharacters(view.lastFrame() ?? ""), /draft \[Image #1\]/)
  assert.doesNotMatch(view.lastFrame() ?? "", /draft @attachments\/image_clipboard\.png/)
  assert.doesNotMatch(view.lastFrame() ?? "", /\[1\] image_clipboard\.png/)
  view.stdin.write("\r")
  await tick(); await tick()
  assert.match(stripVTControlCharacters(view.lastFrame() ?? ""), /draft \[Image #1\]/)
  view.stdin.write("继续")
  await tick(); await tick()
  assert.match(stripVTControlCharacters(view.lastFrame() ?? ""), /draft \[Image #1\] 继续/)
  view.stdin.write("\u007f")
  await tick(); await tick()
  assert.match(stripVTControlCharacters(view.lastFrame() ?? ""), /draft \[Image #1\] 继/)
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
