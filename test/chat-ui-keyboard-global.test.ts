import assert from "node:assert/strict"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { AgentConversation } from "../src/agent.js"
import type { ChatModel } from "../src/protocol.js"
import { AlternateHelpDialog, ApprovalBridge, ChatApp, ViewportInputBridge, type ChatAppProps } from "../src/ui/chat-app.js"
import { AlternateTranscriptViewer } from "../src/ui/components/transcript-viewer.js"
import type { TranscriptItem } from "../src/ui/transcript-model.js"
import { stripVTControlCharacters } from "node:util"
import { tick, visibleFrame } from "./support/chat-ui.js"

function props(sessionId: string, conversation: AgentConversation): ChatAppProps {
  return {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId, restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
}

test("Kitty Shift+Tab and uppercase Ctrl+H work through the central input route", async (t) => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const view = render(React.createElement(ChatApp, props("session_keyboard_global", conversation)))
  t.after(() => view.unmount())
  view.stdin.write("\u001b[9;2u"); await tick(); await tick()
  assert.match(stripVTControlCharacters(view.lastFrame() ?? ""), /Plan/)
  view.stdin.write("\u001b[9;2u"); await tick(); await tick()
  assert.doesNotMatch(stripVTControlCharacters(view.lastFrame() ?? ""), /Plan/)
  view.stdin.write("\u001b[72;5u"); await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /Keyboard shortcuts and help/)
  view.stdin.write("\u001b[72;5u"); await tick(); await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /Keyboard shortcuts and help/)
})

test("alternate help closes and navigates through the shared viewport input bridge", async (t) => {
  for (const [input, key] of [["q", {}], ["c", { ctrl: true }], ["h", { ctrl: true }], ["", { escape: true }]] as const) {
    let closed = false
    const bridge = new ViewportInputBridge()
    const view = render(React.createElement(AlternateHelpDialog, { language: "en", onClose: () => { closed = true }, inputBridge: bridge }))
    t.after(() => view.unmount()); await tick(); bridge.dispatch(input, key); await tick()
    assert.equal(closed, true)
    view.unmount()
  }
  const bridge = new ViewportInputBridge()
  const view = render(React.createElement(AlternateHelpDialog, { language: "en", onClose: () => {}, inputBridge: bridge }))
  t.after(() => view.unmount()); await tick()
  const start = visibleFrame(view)
  bridge.dispatch("", { end: true }); await tick(); assert.notEqual(visibleFrame(view), start)
  bridge.dispatch("", { home: true }); await tick(); assert.equal(visibleFrame(view), start)
})

test("alternate viewer closes and navigates through every supported input", async (t) => {
  const items: TranscriptItem[] = Array.from({ length: 40 }, (_, index) => ({ id: index, kind: "info", text: `message-${index}` }))
  for (const [input, key] of [["q", {}], ["c", { ctrl: true }], ["t", { ctrl: true }], ["", { escape: true }]] as const) {
    let closed = false
    const bridge = new ViewportInputBridge()
    const view = render(React.createElement(AlternateTranscriptViewer, { items, language: "en", onClose: () => { closed = true }, inputBridge: bridge }))
    t.after(() => view.unmount()); await tick(); bridge.dispatch(input, key); await tick()
    assert.equal(closed, true)
    view.unmount()
  }
  const bridge = new ViewportInputBridge()
  const view = render(React.createElement(AlternateTranscriptViewer, { items, language: "en", onClose: () => {}, inputBridge: bridge }))
  t.after(() => view.unmount()); await tick()
  const end = visibleFrame(view)
  bridge.dispatch("", { home: true }); await tick(); assert.match(visibleFrame(view), /message-0/)
  bridge.dispatch("", { end: true }); await tick(); assert.equal(visibleFrame(view), end)
  bridge.dispatch("", { pageUp: true }); await tick(); assert.notEqual(visibleFrame(view), end)
  bridge.dispatch("", { pageDown: true }); await tick(); assert.equal(visibleFrame(view), end)
})
