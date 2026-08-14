import assert from "node:assert/strict"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { AgentConversation } from "../src/agent.js"
import type { ChatModel } from "../src/protocol.js"
import { ApprovalBridge, ChatApp, type ChatAppProps } from "../src/ui/chat-app.js"
import { tick, visibleFrame, waitForFrame } from "./support/chat-ui.js"

function propsFor(conversation: AgentConversation): ChatAppProps {
  return {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_followup", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [],
    resumeSession: async () => { throw new Error("unused") }, renameCurrentSession: async () => { throw new Error("unused") },
    exportCurrentSession: async () => "unused", save: async () => {}, reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
    generateFollowupSuggestion: async () => "run the tests",
  }
}

test("shows, accepts, and dismisses a follow-up suggestion", async (t) => {
  let requests = 0
  const model: ChatModel = { async complete() { requests++; return { content: "The change is ready.", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const view = render(React.createElement(ChatApp, propsFor(conversation)))
  t.after(() => view.unmount())

  view.stdin.write("implement this\r")
  assert.match(await waitForFrame(view, /run the tests/), /run the tests/)
  assert.equal(requests, 1)

  view.stdin.write("\t")
  await tick()
  assert.match(visibleFrame(view), /run the tests/)
  assert.equal(requests, 1, "accepting a suggestion must not submit it")

  view.stdin.write(" now")
  await tick()
  assert.doesNotMatch(visibleFrame(view), /Enter a task or @file path/)
})

test("does not generate follow-up suggestions when disabled", async (t) => {
  const model: ChatModel = { async complete() { return { content: "The change is ready.", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const props = { ...propsFor(conversation), followupSuggestions: false }
  const view = render(React.createElement(ChatApp, props))
  t.after(() => view.unmount())

  view.stdin.write("implement this\r")
  await new Promise((resolve) => setTimeout(resolve, 380))
  assert.doesNotMatch(visibleFrame(view), /run the tests/)
})
