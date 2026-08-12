import assert from "node:assert/strict"
import { stripVTControlCharacters } from "node:util"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { AgentConversation } from "../src/agent.js"
import type { ChatModel, Message } from "../src/protocol.js"
import {
  IMAGE_ATTACHMENT_TOKEN, attachmentTokenIndex, composerDraftEqual, expandComposerValue, insertAttachmentTokens,
  pastedTextNode, removeAttachmentToken, shouldFoldPastedText,
} from "../src/ui/attachment-model.js"
import { createComposerOwner } from "../src/ui/composer-owner.js"
import { createEditor, type EditorState } from "../src/ui/editor.js"
import { enqueueMessage, takeNextMessage } from "../src/ui/message-queue.js"
import { composerInputContent } from "../src/ui/components/chat-composer.js"

test("paste folding follows OpenCode line and JS length thresholds", () => {
  assert.equal(shouldFoldPastedText("a\nb\nc"), true)
  assert.equal(shouldFoldPastedText("x".repeat(151)), true)
  assert.equal(shouldFoldPastedText(`${"x".repeat(74)}\n${"y".repeat(75)}`), false)
  assert.equal(shouldFoldPastedText("x".repeat(150)), false)
})

test("composer renders pasted text labels including a long single line", (t) => {
  const node = pastedTextNode("x".repeat(151))
  const rendered = composerInputContent(IMAGE_ATTACHMENT_TOKEN, 1, [node])
  const view = render(React.createElement(React.Fragment, null, ...rendered))
  t.after(() => view.unmount())
  assert.equal(stripVTControlCharacters(view.lastFrame() ?? "").trim(), "[Pasted ~1 lines]")
})

test("inline nodes expand in exact order and identical labels do not cross-wire", () => {
  const first = pastedTextNode("first\na\nb")
  const second = pastedTextNode("second\na\nb")
  const image = { kind: "image" as const, reference: "attachments/a.png", name: "a.png" }
  const value = `before ${IMAGE_ATTACHMENT_TOKEN} middle ${IMAGE_ATTACHMENT_TOKEN} image ${IMAGE_ATTACHMENT_TOKEN} after`
  assert.equal(expandComposerValue(value, [first, second, image], "model"), "before first\na\nb middle second\na\nb image @attachments/a.png after")
  assert.equal(expandComposerValue(value, [first, second, image], "display"), "before [Pasted ~3 lines] middle [Pasted ~3 lines] image [Image #1] after")
})

test("Backspace and Delete identify and remove a pasted node atomically", () => {
  const node = pastedTextNode("one\ntwo\nthree")
  let editor: EditorState = insertAttachmentTokens(createEditor())
  assert.equal(attachmentTokenIndex(editor, "backspace"), 0)
  editor = removeAttachmentToken(editor, 0)
  assert.equal(editor.value, "")
  assert.deepEqual([node].filter((_, index) => index !== 0), [])

  editor = { ...insertAttachmentTokens(createEditor()), cursor: 0 }
  assert.equal(attachmentTokenIndex(editor, "delete"), 0)
  editor = removeAttachmentToken(editor, 0)
  assert.equal(editor.value, "")
})

test("history snapshots restore folded labels and original pasted text", () => {
  const owner = createComposerOwner()
  const node = pastedTextNode("one\ntwo\nthree")
  owner.setHistory([{ value: IMAGE_ATTACHMENT_TOKEN, nodes: [node] }])
  const recalled = owner.getSnapshot().history[0]!
  owner.setEditor(createEditor(recalled.value))
  owner.setNodes(recalled.nodes)
  assert.equal(expandComposerValue(owner.getSnapshot().editor.value, owner.getSnapshot().nodes, "display"), "[Pasted ~3 lines]")
  assert.equal(expandComposerValue(owner.getSnapshot().editor.value, owner.getSnapshot().nodes, "model"), "one\ntwo\nthree")
  owner.destroy()
})

test("queued composer drafts retain pasted text through FIFO draining", () => {
  const node = pastedTextNode("queued\nfull\ntext")
  const queued = enqueueMessage([], { value: `before ${IMAGE_ATTACHMENT_TOKEN} after`, nodes: [node] })
  const next = takeNextMessage(queued)
  assert.equal(expandComposerValue(next.message!.value, next.message!.nodes, "display"), "before [Pasted ~3 lines] after")
  assert.equal(expandComposerValue(next.message!.value, next.message!.nodes, "model"), "before queued\nfull\ntext after")
})

test("structured draft equality preserves old history de-duplication semantics", () => {
  const first = { value: IMAGE_ATTACHMENT_TOKEN, nodes: [pastedTextNode("same\nfull\ntext")] }
  const duplicate = { value: IMAGE_ATTACHMENT_TOKEN, nodes: [pastedTextNode("same\nfull\ntext")] }
  const different = { value: IMAGE_ATTACHMENT_TOKEN, nodes: [pastedTextNode("other\nfull\ntext")] }
  assert.equal(composerDraftEqual(first, duplicate), true)
  assert.equal(composerDraftEqual(first, different), false)
})

test("turn events retain display labels while model and conversation receive full text", async () => {
  const events: Array<{ type: string; input?: string }> = []
  const captured: Message[][] = []
  const model: ChatModel = { async complete(request) { captured.push(request.messages); return { content: "done", toolCalls: [] } } }
  const agent = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false, onEvent: (event) => events.push(event) })
  await agent.run("before full\nlarge\ntext after", { displayInput: "before [Pasted ~3 lines] after" })
  assert.equal(events.find((event) => event.type === "turn.started")?.input, "before [Pasted ~3 lines] after")
  assert.equal([...captured[0]!].reverse().find((message) => message.role === "user")?.content, "before full\nlarge\ntext after")
  assert.equal(agent.history().reverse().find((message) => message.role === "user")?.content, "before full\nlarge\ntext after")
})
