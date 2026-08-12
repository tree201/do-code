import assert from "node:assert/strict"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { AgentConversation } from "../src/agent.js"
import type { PromptExtension } from "../src/extension-registry.js"
import type { ChatModel, Message } from "../src/protocol.js"
import { ApprovalBridge, ChatApp, type ChatAppProps } from "../src/ui/chat-app.js"
import { tick, visibleFrame } from "./support/chat-ui.js"

const paste = (text: string) => `\u001b[200~${text}\u001b[201~`

function renderChat(t: test.TestContext, options: {
  model?: ChatModel
  promptExtensions?: PromptExtension[]
  pasteImage?: ChatAppProps["pasteImage"]
} = {}) {
  const model = options.model ?? { async complete() { return { content: "done", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const view = render(React.createElement(ChatApp, {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_pasted_text", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    ...(options.promptExtensions ? { promptExtensions: options.promptExtensions } : {}),
    ...(options.pasteImage ? { pasteImage: options.pasteImage } : {}),
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [],
    resumeSession: async () => { throw new Error("unused") }, renameCurrentSession: async () => { throw new Error("unused") },
    exportCurrentSession: async () => "unused", save: async () => {}, reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  } satisfies ChatAppProps))
  t.after(() => view.unmount())
  return { view, conversation }
}

async function waitPastReturnGuard() {
  await new Promise((resolve) => setTimeout(resolve, 550))
}

function lastUser(messages: Message[]) {
  return [...messages].reverse().find((message) => message.role === "user")?.content
}

test("ChatApp folds bracketed paste, submits full text, and restores the folded history draft", async (t) => {
  const requests: Message[][] = []
  const { view, conversation } = renderChat(t, { model: { async complete(request) { requests.push(request.messages); return { content: "done", toolCalls: [] } } } })
  view.stdin.write(paste("one\ntwo\nthree"))
  await tick(); await tick()
  assert.match(visibleFrame(view), /\[Pasted ~3 lines\]/)
  assert.doesNotMatch(visibleFrame(view), /^\s*(?:one|two|three)\s*$/m)

  view.stdin.write("\r")
  await tick()
  assert.equal(requests.length, 0, "the Return leaked by a paste must remain suppressed")
  await waitPastReturnGuard()
  view.stdin.write("\r")
  await tick(); await tick()
  assert.equal(lastUser(requests[0]!), "one\ntwo\nthree")
  assert.equal(lastUser(conversation.history()), "one\ntwo\nthree")
  assert.match(visibleFrame(view), /\[Pasted ~3 lines\]/)
  assert.doesNotMatch(visibleFrame(view), /^\s*(?:one|two|three)\s*$/m)

  view.stdin.write("\u001b[A")
  await tick(); await tick()
  assert.match(visibleFrame(view), /\[Pasted ~3 lines\]/)
  assert.doesNotMatch(visibleFrame(view), /^\s*(?:one|two|three)\s*$/m)
})

test("pasted slash text cannot impersonate a built-in command", async (t) => {
  let requests = 0
  const { view, conversation } = renderChat(t, { model: { async complete() { requests++; return { content: "done", toolCalls: [] } } } })
  view.stdin.write(paste("/help\nwith\ncontext"))
  await tick(); await waitPastReturnGuard()
  view.stdin.write("\r")
  await tick(); await tick()
  assert.equal(requests, 1)
  assert.equal(lastUser(conversation.history()), "/help\nwith\ncontext")
  assert.doesNotMatch(visibleFrame(view), /Keyboard shortcuts and help/)
})

test("prompt extension arguments expand pasted text and mixed image references exactly once", async (t) => {
  const requests: Message[][] = []
  const extension: PromptExtension = {
    name: "review", description: "review input", prompt: "Review this:\n$ARGUMENTS", source: "project", kind: "command", file: "/tmp/review.md",
  }
  const { view } = renderChat(t, {
    promptExtensions: [extension],
    pasteImage: async () => ({ reference: "attachments/mixed.png", name: "mixed.png", size: 10 }),
    model: { async complete(request) { requests.push(request.messages); return { content: "done", toolCalls: [] } } },
  })
  view.stdin.write("/review before ")
  await tick()
  view.stdin.write(paste("pasted\nfull\ntext"))
  await tick(); await tick()
  view.stdin.write("\u0016")
  await tick(); await tick(); await tick()
  view.stdin.write(" after")
  await tick(); await waitPastReturnGuard()
  assert.match(visibleFrame(view), /\/review before\s+\[Pasted ~3 lines\]\s*\[Image #1\]\s+after/)
  view.stdin.write("\r")
  await tick(); await tick()

  const input = lastUser(requests[0]!) ?? ""
  assert.equal(input, "Review this:\nbefore pasted\nfull\ntext@attachments/mixed.png after")
  assert.equal(input.match(/@attachments\/mixed\.png/g)?.length, 1)
  assert.match(visibleFrame(view), /\/review before\s+\[Pasted ~3 lines\]\s*\[Image #1\]\s+after/)
  assert.doesNotMatch(visibleFrame(view), /pasted\s+full\s+text/)
})
