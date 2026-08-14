import assert from "node:assert/strict"
import { stripVTControlCharacters } from "node:util"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { AgentConversation } from "../src/agent.js"
import type { ChatModel } from "../src/protocol.js"
import { ApprovalBridge, ChatApp, QuestionBridge, type ChatAppProps } from "../src/ui/chat-app.js"
import { tick, visibleFrame } from "./support/chat-ui.js"

test("history navigation continues past a recalled slash command", async (t) => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const view = render(React.createElement(ChatApp, {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_history_completion", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  } satisfies ChatAppProps))
  t.after(() => view.unmount())

  view.stdin.write("/status\r")
  await tick(); await tick()
  view.stdin.write("/model\r")
  await tick(); await tick()
  view.stdin.write("\u001b")
  await tick(); await tick()

  view.stdin.write("\u001b[A")
  await tick()
  assert.match(visibleFrame(view), /› \/model/)
  view.stdin.write("\u001b[A")
  await tick()
  assert.match(visibleFrame(view), /› \/status/)
})

test("editor shortcuts move, delete, clear, undo, redo, and insert newlines", async (t) => {
  let requests = 0
  const model: ChatModel = { async complete() { requests++; return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const view = render(React.createElement(ChatApp, {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_editor_shortcuts", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  } satisfies ChatAppProps))
  t.after(() => view.unmount())

  view.stdin.write("abc")
  await tick()
  view.stdin.write("\u001b[D")
  view.stdin.write("x")
  await tick()
  assert.match(stripVTControlCharacters(view.lastFrame() ?? ""), /abxc/)
  view.stdin.write("\u001b[1;5D")
  view.stdin.write("y")
  await tick()
  assert.match(stripVTControlCharacters(view.lastFrame() ?? ""), /abyxc/)
  view.stdin.write("\u0015")
  view.stdin.write("abc")
  await tick()
  view.stdin.write("\u0001")
  await tick()
  view.stdin.write("x")
  await tick()
  assert.match(stripVTControlCharacters(view.lastFrame() ?? ""), /xabc/)
  view.stdin.write("\u0005")
  view.stdin.write("y")
  await tick()
  assert.match(stripVTControlCharacters(view.lastFrame() ?? ""), /xabcy/)
  view.stdin.write("\u0001")
  view.stdin.write("\u0004")
  await tick()
  assert.match(stripVTControlCharacters(view.lastFrame() ?? ""), /abcy/)
  view.stdin.write("\u001a")
  await tick()
  assert.match(stripVTControlCharacters(view.lastFrame() ?? ""), /xabcy/)
  view.stdin.write("\u0019")
  await tick()
  assert.match(stripVTControlCharacters(view.lastFrame() ?? ""), /abcy/)
  view.stdin.write("\u0015")
  await tick()
  assert.doesNotMatch(stripVTControlCharacters(view.lastFrame() ?? ""), /abcy/)
  view.stdin.write("first\u000asecond")
  await tick()
  assert.match(view.lastFrame() ?? "", /first/)
  assert.match(view.lastFrame() ?? "", /second/)
  assert.equal(requests, 0)
})

test("Alt+Enter inserts a composer newline without submitting", async (t) => {
  let requests = 0
  const model: ChatModel = { async complete() { requests++; return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const view = render(React.createElement(ChatApp, {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_alt_enter", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  } satisfies ChatAppProps))
  t.after(() => view.unmount())
  view.stdin.write("first\u001b[13;3usecond")
  await tick()
  assert.match(view.lastFrame() ?? "", /first/)
  assert.match(view.lastFrame() ?? "", /second/)
  assert.equal(requests, 0)
})

test("approval dialog supports numeric, y/n, and Escape shortcuts", async (t) => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const approvalBridge = new ApprovalBridge()
  const view = render(React.createElement(ChatApp, {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_approval_keys", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge, attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  } satisfies ChatAppProps))
  t.after(() => view.unmount())
  const request = { tool: "shell", title: "Run command", detail: "npm test", args: { command: "npm test" }, decision: "ask" as const, risk: "medium" as const, reason: "approval", matchedRule: "test", dangerous: false }

  const numeric = approvalBridge.request(request)
  await tick(); view.stdin.write("3")
  assert.equal(await numeric, "always")
  const yes = approvalBridge.request(request)
  await tick(); view.stdin.write("y")
  assert.equal(await yes, "once")
  const no = approvalBridge.request(request)
  await tick(); view.stdin.write("n")
  assert.equal(await no, "deny")
  const escaped = approvalBridge.request(request)
  await tick(); view.stdin.write("\u001b")
  assert.equal(await escaped, "deny")
})


test("permission menu supports number selection and Escape cancellation", async (t) => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const view = render(React.createElement(ChatApp, {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_permission_keys", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  } satisfies ChatAppProps))
  t.after(() => view.unmount())
  view.stdin.write("/permissions\r")
  await tick(); await tick()
  view.stdin.write("2")
  await tick(); await tick()
  assert.match(visibleFrame(view), /test-model · default · 0% · auto/)
  assert.doesNotMatch(visibleFrame(view), /Approval mode:/)
  view.stdin.write("/permissions\r")
  await tick(); await tick()
  view.stdin.write("\u001b")
  await tick(); await tick()
  assert.doesNotMatch(visibleFrame(view), /Update Model Permissions/)
  assert.match(visibleFrame(view), /test-model · default · 0% · auto/)
})

test("question dialog uses Escape to return from custom input and then cancel", async (t) => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const questionBridge = new QuestionBridge()
  const view = render(React.createElement(ChatApp, {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_question_escape", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(), questionBridge, attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  } satisfies ChatAppProps))
  t.after(() => view.unmount())
  const answer = questionBridge.request("Choose", ["One", "Other — Enter a different answer"])
  await tick()
  view.stdin.write("\u001b[B")
  view.stdin.write("\r")
  await tick(); await tick()
  assert.match(visibleFrame(view), /Type an answer/)
  view.stdin.write("draft")
  view.stdin.write("\u001b")
  await tick(); await tick()
  assert.match(visibleFrame(view), /One/)
  assert.doesNotMatch(visibleFrame(view), /Type an answer/)
  view.stdin.write("\u001b")
  assert.equal(await answer, "User cancelled the question")
})

test("session picker supports navigation, Enter, Escape, and Ctrl+C", async (t) => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const resumed: string[] = []
  const sessions = [
    { id: "session_one", workspace: process.cwd(), title: "First session", updatedAt: "2026-08-11T00:00:00Z", directory: "/tmp/session_one" },
    { id: "session_two", workspace: process.cwd(), title: "Second session", updatedAt: "2026-08-11T01:00:00Z", directory: "/tmp/session_two" },
  ]
  const view = render(React.createElement(ChatApp, {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_picker_keys", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => sessions,
    resumeSession: async (id) => { resumed.push(id); const session = sessions.find((item) => item.id === id)!; return { session, messages: [], events: [] } },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  } satisfies ChatAppProps))
  t.after(() => view.unmount())

  view.stdin.write("/resume\r")
  await tick(); await tick()
  assert.match(visibleFrame(view), /First session/)
  view.stdin.write("\u001b")
  await tick(); await tick()
  assert.doesNotMatch(visibleFrame(view), /First session/)

  view.stdin.write("/resume\r")
  await tick(); await tick()
  view.stdin.write("\u0003")
  await tick(); await tick()
  assert.doesNotMatch(visibleFrame(view), /First session/)

  view.stdin.write("/resume\r")
  await tick(); await tick()
  view.stdin.write("\u001b[B")
  view.stdin.write("\r")
  await tick(); await tick(); await tick()
  assert.deepEqual(resumed, ["session_two"])
})
