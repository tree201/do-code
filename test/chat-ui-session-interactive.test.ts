import assert from "node:assert/strict"
import { stripVTControlCharacters } from "node:util"
import test from "node:test"
import React from "react"
import { render } from "ink-testing-library"
import { AgentConversation } from "../src/agent.js"
import type { ChatModel, Message } from "../src/protocol.js"
import { ApprovalBridge, ChatApp, type ChatAppProps } from "../src/ui/chat-app.js"
import { tick } from "./support/chat-ui.js"

test("language command switches the live interface with second-level completion", async () => {
  const model:ChatModel={async complete(){return {content:"done",toolCalls:[]}}}
  const conversation=new AgentConversation({workspace:process.cwd(),model,approveShell:async()=>false})
  let selected=""
  let selectedThinking=""
  const props:ChatAppProps={
    workspace:process.cwd(),model:"test-model",approvalMode:"ask",sessionId:"session_language",restored:false,initialMessages:[],conversation,
    language:"en",setLanguage:async(language)=>{selected=language},approvalBridge:new ApprovalBridge(),attachEventSink:()=>{},
    thinkingMode:"auto",switchThinking:async(mode)=>{selectedThinking=mode;return {source:"config",sourceLabel:"test",preset:"test-model",provider:"test",modelId:"test-model",baseUrl:"https://example.com/v1",apiKey:"test",thinkingMode:mode,effectiveThinkingMode:mode}},
    runShellShortcut:async()=>({ok:true,output:""}),listSessions:async()=>[],resumeSession:async()=>{throw new Error("unused")},
    renameCurrentSession:async()=>{throw new Error("unused")},exportCurrentSession:async()=>"unused",save:async()=>{},
    reportError:async()=>({id:"err_test",file:"/tmp/error.json"}),
  }
  const view=render(React.createElement(ChatApp,props))
  view.stdin.write("/language ")
  await tick();await tick()
  assert.match(view.lastFrame()??"",/zh.*Chinese/)
  view.stdin.write("zh\r")
  await tick();await tick()
  assert.equal(selected,"zh")
  assert.doesNotMatch(stripVTControlCharacters(view.frames.join("\n")),/语言已切换为中文/)
  assert.match(stripVTControlCharacters(view.lastFrame()??""),/输入任务或 @文件路径/)
  view.stdin.write("/")
  await tick()
  assert.match(stripVTControlCharacters(view.lastFrame()??""),/\/help  查看可用命令/)
  view.stdin.write("\u0015")
  view.stdin.write("/thinking ")
  await tick();await tick()
  const thinkingSuggestions = stripVTControlCharacters(view.lastFrame()??"")
  assert.match(thinkingSuggestions,/auto.*当前思考模式/)
  assert.match(thinkingSuggestions,/off.*关闭思考/)
  view.stdin.write("off\r")
  await tick();await tick()
  assert.equal(selectedThinking,"off")
  assert.doesNotMatch(stripVTControlCharacters(view.lastFrame()??""),/思考模式：off/)
  view.stdin.write("/thinking\r")
  await tick();await tick()
  assert.match(stripVTControlCharacters(view.lastFrame()??""),/思考模式：off/)
  view.unmount()
})

test("restored sessions initialize the context percentage", async () => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const initialMessages: Message[] = [{ role: "system", content: "x".repeat(5_000) }, { role: "user", content: "Resume this session" }]
  conversation.restore(initialMessages)
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_restored", restored: true, initialMessages, conversation,
    approvalBridge: new ApprovalBridge(), attachEventSink: () => {}, runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [],
    resumeSession: async () => { throw new Error("unused") }, renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  await tick()
  assert.match(view.lastFrame() ?? "", /test-model · default · [1-9][0-9]*%/)
  view.unmount()
})

test("resuming a session restores conversation and read-only tool history without replaying tools", async () => {
  const model: ChatModel = { async complete() { return { content: "done", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  const messages: Message[] = [
    { role: "system", content: `system instructions ${"x".repeat(5_000)}` },
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "I will inspect it.", tool_calls: [{ id: "tool_1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "src/main.ts" }) } }] },
    { role: "tool", tool_call_id: "tool_1", content: "OK: SECRET HISTORICAL TOOL OUTPUT" },
    { role: "assistant", content: "Earlier answer" },
  ]
  const events = [
    { createdAt: "2026-08-07T00:00:00.000Z", event: { protocolVersion: 1, turnId: "turn_old", type: "turn.started", input: "Earlier question" } },
    { createdAt: "2026-08-07T00:00:00.500Z", event: { protocolVersion: 1, turnId: "turn_old", type: "approval.resolved", step: 1, callId: "approved_tool", name: "read_file", approved: true, choice: "session" } },
    { createdAt: "2026-08-07T00:00:01.000Z", event: { protocolVersion: 1, turnId: "turn_old", type: "tool.started", step: 1, callId: "tool_1", name: "read_file", args: { path: "src/main.ts" } } },
    { createdAt: "2026-08-07T00:00:02.000Z", event: { protocolVersion: 1, turnId: "turn_old", type: "tool.completed", step: 1, callId: "tool_1", name: "read_file", ok: true, output: "SECRET HISTORICAL TOOL OUTPUT" } },
    { createdAt: "2026-08-07T00:00:02.500Z", event: { protocolVersion: 1, turnId: "turn_old", type: "approval.resolved", step: 2, callId: "denied_tool", name: "shell", approved: false, choice: "deny" } },
    { createdAt: "2026-08-07T00:00:02.600Z", event: { protocolVersion: 1, turnId: "turn_old", type: "tool.started", step: 2, callId: "plan_1", name: "exit_plan_mode", args: { title: "Safe refactor", summary: "Split the module without changing behavior.", steps: ["Extract helpers", "Run tests"], files: ["src/main.ts"], verification: ["npm test"], risks: ["Import paths"] } } },
    { createdAt: "2026-08-07T00:00:02.700Z", event: { protocolVersion: 1, turnId: "turn_old", type: "tool.completed", step: 2, callId: "plan_1", name: "exit_plan_mode", ok: true, output: "Plan approved." } },
    { createdAt: "2026-08-07T00:00:03.000Z", event: { protocolVersion: 1, turnId: "turn_old", type: "turn.completed", output: "Earlier answer" } },
  ]
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "test-model", approvalMode: "ask", sessionId: "session_current", restored: false, initialMessages: [], conversation,
    approvalBridge: new ApprovalBridge(), attachEventSink: () => {}, runShellShortcut: async () => ({ ok: true, output: "" }),
    listSessions: async () => [{ id: "session_old", title: "Old work", workspace: process.cwd(), updatedAt: new Date().toISOString(), directory: "/tmp/session_old" }],
    resumeSession: async () => {
      conversation.restore(messages)
      return { session: { id: "session_old", title: "Old work", workspace: process.cwd(), updatedAt: new Date().toISOString(), directory: "/tmp/session_old" }, messages, events }
    },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  view.stdin.write("/resu")
  await tick()
  view.stdin.write("\r")
  await tick()
  assert.match(view.lastFrame() ?? "", /Resume a previous session/)
  view.stdin.write("\r")
  await tick()
  await tick()
  const frame = view.lastFrame() ?? ""
  assert.match(frame, /Resumed session: Old work/)
  assert.match(frame, /test-model · default · [1-9][0-9]*%/)
  assert.match(frame, /Restored 3\/3 conversation messages/)
  assert.match(frame, /1 historical tool action/)
  assert.match(frame, /Earlier question/)
  assert.match(frame, /Earlier answer/)
  assert.match(frame, /I will inspect it/)
  assert.match(frame, /Explored/)
  assert.match(frame, /Read src\/main\.ts/)
  const restoredLines = frame.split("\n")
  const questionLine = restoredLines.findIndex((line) => line.includes("Earlier question"))
  const toolLine = restoredLines.findIndex((line) => line.includes("Explored"))
  assert.ok(questionLine >= 0 && toolLine > questionLine)
  assert.equal(restoredLines[toolLine - 1]?.trim(), "", "restored tool activity should own its leading row")
  assert.doesNotMatch(frame, /Permission granted/)
  assert.doesNotMatch(frame, /Permission denied for shell/)
  assert.match(frame, /Safe refactor/)
  assert.match(frame, /Split the module without changing behavior/)
  assert.match(frame, /1\. Extract helpers/)
  assert.match(frame, /Files/)
  assert.match(frame, /`src\/main\.ts`/)
  assert.doesNotMatch(frame, /Plan approved/)
  assert.doesNotMatch(frame, /SECRET HISTORICAL TOOL OUTPUT/)
  view.stdin.write("\u000f")
  await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /SECRET HISTORICAL TOOL OUTPUT/, "Ctrl+O no longer reveals raw historical output")
  view.unmount()
})
