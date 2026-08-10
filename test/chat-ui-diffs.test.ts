import assert from "node:assert/strict"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { Box } from "ink"
import { AgentConversation } from "../src/agent.js"
import type { AgentEvent, ChatModel } from "../src/protocol.js"
import { ApprovalBridge, ChatApp, TranscriptBlock, TranscriptLine, type ChatAppProps } from "../src/ui/chat-app.js"
import { tick, visibleFrame } from "./support/chat-ui.js"

test("edit activities render a compact line-numbered Codex-style diff", () => {
  const view = render(React.createElement(TranscriptLine, {
    item: {
      id: 3,
      kind: "tool",
      tools: [{
        name: "edit_file",
        args: {},
        ok: true,
        output: "done",
        presentation: {
          kind: "edit",
          fileChanges: [{
            path: "src/main.js",
            additions: 1,
            deletions: 1,
            diffLines: [
              { kind: "remove", text: "const oldValue = true", oldLine: 140 },
              { kind: "add", text: "const newValue = true", newLine: 140 },
            ],
          }],
        },
      }],
    },
    width: 72,
    language: "en",
  }))
  const frame = visibleFrame(view)
  assert.match(frame, /• Edited src\/main\.js \(\+1 -1\)/)
  assert.match(frame, /140 - const oldValue = true/)
  assert.match(frame, /140 \+ const newValue = true/)
  const diffRows = frame.split("\n").filter((line) => /140 [-+] const/.test(line))
  assert.ok(diffRows.every((line) => line.indexOf("140") === 4), "line numbers should be right-aligned in a seven-cell gutter")
  assert.equal((frame.match(/src\/main\.js/g) ?? []).length, 1)
  view.unmount()
})

test("multi-file edit headers and code share the Codex seven-cell line-number grid", () => {
  const view = render(React.createElement(TranscriptLine, {
    item: {
      id: 31,
      kind: "tool",
      tools: [{
        name: "apply_patch",
        args: {},
        ok: true,
        output: "done",
        presentation: {
          kind: "edit",
          fileChanges: [
            {
              path: "src/main.js",
              additions: 1,
              deletions: 0,
              diffLines: [{ kind: "add", text: "makeNightLightsTexture,", newLine: 12 }],
            },
            {
              path: "src/style.css",
              additions: 1,
              deletions: 0,
              diffLines: [{ kind: "add", text: ".panel {}", newLine: 220 }],
            },
          ],
        },
      }],
    },
    width: 72,
    language: "en",
  }))
  const frame = visibleFrame(view)
  assert.match(frame, /^  └ src\/main\.js \(\+1 -0\)$/m)
  assert.match(frame, /^     12 \+ makeNightLightsTexture,\s*$/m)
  assert.match(frame, /^    220 \+ \.panel \{\}\s*$/m)
  view.unmount()
})

test("multi-file diffs keep one visual row before the next tool activity", () => {
  const editItem = {
    id: 32,
    kind: "tool" as const,
    tools: [{
      name: "apply_patch",
      args: {},
      ok: true,
      output: "done",
      presentation: {
        kind: "edit" as const,
        fileChanges: [
          {
            path: "src/main.js",
            additions: 1,
            deletions: 0,
            diffLines: [{ kind: "add" as const, text: "const ready = true", newLine: 12 }],
          },
          {
            path: "src/style.css",
            additions: 1,
            deletions: 0,
            diffLines: [{ kind: "add" as const, text: ".panel {}", newLine: 220 }],
          },
        ],
      },
    }],
  }
  const nextItem = {
    id: 33,
    kind: "tool" as const,
    tools: [{
      name: "read_file",
      args: { path: "README.md" },
      ok: true,
      output: "done",
      presentation: { kind: "explore" as const, targets: ["README.md"] },
    }],
  }
  const view = render(React.createElement(Box, { flexDirection: "column", width: 72 },
    React.createElement(TranscriptBlock, { first: true }, React.createElement(TranscriptLine, { item: editItem, width: 72, language: "en" })),
    React.createElement(TranscriptBlock, null, React.createElement(TranscriptLine, { item: nextItem, width: 72, language: "en" })),
  ))
  const lines = (view.lastFrame() ?? "").split("\n")
  const finalDiffLine = lines.findIndex((line) => line.includes(".panel {}"))
  const nextActivityLine = lines.findIndex((line, index) => index > finalDiffLine && line.includes("Explored"))
  assert.ok(finalDiffLine >= 0 && nextActivityLine > finalDiffLine)
  assert.equal(lines[finalDiffLine + 1]?.trim(), "")
  assert.equal(nextActivityLine, finalDiffLine + 2)
  view.unmount()
})

test("independent tool activities keep one visual boundary row", () => {
  const firstItem = {
    id: 34,
    kind: "tool" as const,
    tools: [{ name: "list_directory", args: { path: "." }, ok: true, output: "hello.cpp" }],
  }
  const secondItem = {
    id: 35,
    kind: "tool" as const,
    tools: [{
      name: "shell",
      args: { command: "g++ hello.cpp -o hello_cpp && ./hello_cpp" },
      ok: true,
      output: "Hello, World!",
      presentation: { kind: "command" as const, command: "g++ hello.cpp -o hello_cpp && ./hello_cpp", excerpt: ["Hello, World!"] },
    }],
  }
  const view = render(React.createElement(Box, { flexDirection: "column", width: 72 },
    React.createElement(TranscriptBlock, { first: true }, React.createElement(TranscriptLine, { item: firstItem, width: 72, language: "en" })),
    React.createElement(TranscriptBlock, null, React.createElement(TranscriptLine, { item: secondItem, width: 72, language: "en" })),
  ))
  const lines = (view.lastFrame() ?? "").split("\n")
  const firstLine = lines.findIndex((line) => line.includes("Explored"))
  const secondLine = lines.findIndex((line) => line.includes("Ran g++ hello.cpp"))
  assert.ok(firstLine >= 0 && secondLine > firstLine)
  assert.equal(lines[secondLine - 1]?.trim(), "")
  assert.equal(secondLine, firstLine + 3, "independent activities should be separated by one row")
  view.unmount()
})

test("line-number gaps render explicit unchanged-region omissions without hiding changed lines", () => {
  const view = render(React.createElement(TranscriptLine, {
    item: {
      id: 4,
      kind: "tool",
      tools: [{
        name: "apply_patch",
        args: {},
        ok: true,
        output: "done",
        presentation: {
          kind: "edit",
          fileChanges: [{
            path: "src/main.js",
            additions: 8,
            deletions: 0,
            diffLines: [
              { kind: "add", text: "const first = true", newLine: 10 },
              { kind: "add", text: "const second = true", newLine: 20 },
            ],
          }],
        },
      }],
    },
    width: 72,
    language: "zh",
  }))
  const frame = visibleFrame(view)
  assert.match(frame, /^\s*⋮\s*$/m)
  assert.doesNotMatch(frame, /省略.*行修改/)
  view.unmount()
})

test("completed edit batches keep large diffs out of the animated pending region", async () => {
  const model: ChatModel = { async complete() { return { content: "done", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  let sink: ((event: AgentEvent) => void) | null = null
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_static_edits", restored: false,
    initialMessages: [], conversation, language: "en", approvalBridge: new ApprovalBridge(),
    attachEventSink: (next) => { sink = next }, runShellShortcut: async () => ({ ok: true, output: "" }),
    listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  await tick()
  const activeSink = sink as ((event: AgentEvent) => void) | null
  assert.ok(activeSink)

  activeSink({ protocolVersion: 1, turnId: "turn_test", type: "tool.started", step: 1, callId: "edit_a", name: "edit_file", args: { path: "src/a.ts", old_text: "old-a", new_text: "new-a" } })
  activeSink({ protocolVersion: 1, turnId: "turn_test", type: "tool.completed", step: 1, callId: "edit_a", name: "edit_file", ok: true, output: "Edited src/a.ts" })
  activeSink({ protocolVersion: 1, turnId: "turn_test", type: "tool.started", step: 1, callId: "edit_b", name: "edit_file", args: { path: "src/b.ts", old_text: "old-b", new_text: "new-b" } })
  activeSink({ protocolVersion: 1, turnId: "turn_test", type: "tool.completed", step: 1, callId: "edit_b", name: "edit_file", ok: true, output: "Edited src/b.ts" })
  await tick()

  assert.match(view.lastFrame() ?? "", /Edited 2 files \(\+2 -2\)/)
  assert.doesNotMatch(view.lastFrame() ?? "", /new-a|new-b/, "pending edit batches should render only a compact summary")

  activeSink({ protocolVersion: 1, turnId: "turn_test", type: "step.started", step: 2 })
  await tick()
  const frozenFrame = visibleFrame(view)
  assert.match(frozenFrame, /Edited 2 files \(\+2 -2\)/)
  assert.match(frozenFrame, /new-a/)
  assert.match(frozenFrame, /new-b/)
  view.unmount()
})
