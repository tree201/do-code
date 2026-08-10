import assert from "node:assert/strict"
import test from "node:test"
import type { Message } from "../src/protocol.js"
import { approvalEditDiff, approvalLabels } from "../src/ui/approval-model.js"
import { canOpenHelp, canOpenTranscriptViewer, hasBlockingDialog, showInteractiveComposer, showRunningActivity, type ActiveDialog } from "../src/ui/dialog-coordinator.js"
import { completedToolTranscript } from "../src/ui/live-transcript.js"
import { reduceLiveTranscript, type LiveTranscriptState } from "../src/ui/live-transcript-reducer.js"
import { modelPresetArgument, modelStateFromConfig, nextReasoningEffort, parseReasoningEffort, parseThinkingMode } from "../src/ui/model-actions.js"
import { matchSessionQuery, parseExportArguments, parseRewindMode } from "../src/ui/session-actions.js"
import { filterSessions, sessionPickerWindowStart } from "../src/ui/session-picker-model.js"
import { restoredEventTranscript, restoredSessionItems, restoredTranscript } from "../src/ui/session-transcript.js"
import { routeSlashCommand, slashCommandName } from "../src/ui/slash-command-router.js"
import { createTranscriptOwner } from "../src/ui/transcript-owner.js"

test("session transcript restores ordered event history without replaying tools", () => {
  const items = restoredEventTranscript([
    { event: { type: "turn.started", turnId: "turn-1", input: "inspect the project" } },
    { event: { type: "tool.started", turnId: "turn-1", callId: "call-1", name: "list_directory", args: { path: "." } } },
    { event: { type: "tool.completed", turnId: "turn-1", callId: "call-1", name: "list_directory", step: 1, ok: true, output: "src" } },
    { event: { type: "turn.completed", turnId: "turn-1", output: "The project is ready." } },
  ], "en")
  assert.deepEqual(items.map((item) => item.kind), ["user", "tool", "assistant"])
  assert.equal(items[1]?.kind === "tool" ? items[1].tools[0]?.output : "", "src")
  assert.equal(items[2]?.kind === "assistant" ? items[2].text : "", "The project is ready.")
})

test("session transcript restores assistant text before each historical tool step", () => {
  const messages: Message[] = [
    { role: "user", content: "write hello world" },
    { role: "assistant", content: "I will inspect the directory.", tool_calls: [{ id: "list-1", type: "function", function: { name: "list_directory", arguments: "{\"path\":\".\"}" } }] },
    { role: "tool", tool_call_id: "list-1", content: "OK: hello.c" },
    { role: "assistant", content: "I found hello.c and will read it.", tool_calls: [{ id: "read-1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"hello.c\"}" } }] },
    { role: "tool", tool_call_id: "read-1", content: "OK: source" },
    { role: "assistant", content: "The program is ready." },
  ]
  const events = [
    { event: { type: "turn.started", turnId: "turn-1", input: "write hello world" } },
    { event: { type: "tool.started", turnId: "turn-1", callId: "list-1", name: "list_directory", args: { path: "." } } },
    { event: { type: "tool.completed", turnId: "turn-1", callId: "list-1", name: "list_directory", step: 1, ok: true, output: "hello.c" } },
    { event: { type: "tool.started", turnId: "turn-1", callId: "read-1", name: "read_file", args: { path: "hello.c" } } },
    { event: { type: "tool.completed", turnId: "turn-1", callId: "read-1", name: "read_file", step: 2, ok: true, output: "source" } },
    { event: { type: "turn.completed", turnId: "turn-1", output: "The program is ready." } },
  ]

  const items = restoredTranscript(messages, events)
  assert.deepEqual(items.map((item) => item.kind), ["user", "assistant", "tool", "assistant", "tool", "assistant"])
  assert.equal(items[1]?.kind === "assistant" ? items[1].text : "", "I will inspect the directory.")
  assert.equal(items[3]?.kind === "assistant" ? items[3].text : "", "I found hello.c and will read it.")
})

test("session transcript falls back to stored messages and summarizes resume counts", () => {
  const messages: Message[] = [
    { role: "user", content: "edit the file\n\nReferenced file context:\nsecret" },
    { role: "assistant", content: "I will edit it.", tool_calls: [{ id: "call-2", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "README.md", content: "updated" }) } }] },
    { role: "tool", tool_call_id: "call-2", content: "OK: wrote README.md" },
  ]
  const transcript = restoredTranscript(messages)
  assert.deepEqual(transcript.map((item) => item.kind), ["user", "assistant", "tool"])
  assert.equal(transcript[0]?.kind === "user" ? transcript[0].text : "", "edit the file")
  const resumed = restoredSessionItems("saved session", messages)
  assert.deepEqual(resumed[0], { kind: "resume", title: "saved session", visibleCount: 2, conversationCount: 2, toolCount: 1 })
})

test("session picker filters searchable metadata and keeps a bounded selection window", () => {
  const sessions = [
    { id: "alpha", workspace: "/workspace", title: "First task", model: "model-a", updatedAt: "2026-01-01", directory: "/workspace/.do-code/sessions/alpha" },
    { id: "beta", workspace: "/workspace", title: "Release task", model: "model-b", updatedAt: "2026-01-02", directory: "/workspace/.do-code/sessions/beta" },
    { id: "gamma", workspace: "/workspace", title: "Docs", model: "model-c", updatedAt: "2026-01-03", directory: "/workspace/.do-code/sessions/gamma" },
  ]
  assert.deepEqual(filterSessions(sessions, " release ").map((session) => session.id), ["beta"])
  assert.deepEqual(filterSessions(sessions, "MODEL-C").map((session) => session.id), ["gamma"])
  assert.equal(filterSessions(sessions, "").length, 3)
  assert.equal(sessionPickerWindowStart(0, 20), 0)
  assert.equal(sessionPickerWindowStart(6, 20), 2)
  assert.equal(sessionPickerWindowStart(19, 20), 12)
  assert.equal(sessionPickerWindowStart(19, 3), 0)
})

test("live tool completion maps special and Todo tools without leaking raw events into the UI", () => {
  const base = { protocolVersion: 1 as const, turnId: "turn-1", type: "tool.completed" as const, step: 2, callId: "call-1", output: "listed", ok: true as const, name: "list_directory" }
  const pending = completedToolTranscript(base, { path: "." })
  assert.equal(pending.kind, "pending")
  assert.equal(pending.kind === "pending" ? pending.tool.args && (pending.tool.args as { path: string }).path : "", ".")
  assert.equal(pending.kind === "pending" ? pending.tool.presentation?.kind : "", "explore")

  const hidden = completedToolTranscript({ ...base, name: "todo_write", output: "updated" }, {
    items: [{ id: "one", content: "Inspect", status: "completed" }],
  })
  assert.equal(hidden.kind, "hidden")

  const blocked = completedToolTranscript({ ...base, name: "todo_write", output: "blocked" }, {
    items: [{ id: "one", content: "Blocked task", status: "blocked" }],
  })
  assert.equal(blocked.kind, "pending")
  assert.equal(completedToolTranscript({ ...base, name: "ask_user" }, {}).kind, "ignore")
  assert.equal(completedToolTranscript({ ...base, name: "exit_plan_mode" }, {}).kind, "ignore")
})

test("approval model keeps edit diffs and risk labels independent from the dialog", () => {
  const request = {
    tool: "edit_file",
    title: "Edit file",
    detail: "unused detail",
    args: { path: "src/example.ts", old_text: "old line", new_text: "new line\nsecond line" },
    decision: "ask" as const,
    risk: "high" as const,
    reason: "File changes require approval",
    dangerous: false,
  }
  const diff = approvalEditDiff(request)
  assert.deepEqual(diff, {
    path: "src/example.ts",
    stats: " (+2 -1)",
    additions: 2,
    deletions: 1,
    lines: [{ kind: "remove", text: "old line" }, { kind: "add", text: "new line" }, { kind: "add", text: "second line" }],
    omitted: 0,
  })
  assert.equal(approvalEditDiff({ ...request, tool: "write_file" }), null)
  assert.deepEqual(approvalLabels(request, "en"), { title: "Edit src/example.ts", question: "Allow this file change?", risk: "high risk" })
  assert.deepEqual(approvalLabels({ ...request, tool: "web_fetch" }, "zh"), { title: "访问网络", question: "允许这次网络访问吗？", risk: "高风险" })
})

test("live transcript reducer preserves streaming state and emits explicit side effects", () => {
  const initial: LiveTranscriptState = { liveAssistant: "", reasoningCharacters: 0, activeTool: null, activityEpoch: 0, assistantCommitted: false }
  const started = reduceLiveTranscript(initial, { protocolVersion: 1, turnId: "turn-1", type: "turn.started", input: "inspect" }, "en")
  assert.deepEqual(started.effects, { flushPendingTools: true, commitAssistant: false })

  const delta = reduceLiveTranscript(started.state, { protocolVersion: 1, turnId: "turn-1", type: "message.delta", step: 1, delta: "Hello" }, "en")
  assert.equal(delta.state.liveAssistant, "Hello")
  assert.deepEqual(delta.effects, { flushPendingTools: true, commitAssistant: false })

  const tool = reduceLiveTranscript(delta.state, { protocolVersion: 1, turnId: "turn-1", type: "tool.started", step: 1, callId: "call-1", name: "read_file", args: { path: "README.md" } }, "en")
  assert.equal(tool.state.liveAssistant, "")
  assert.deepEqual(tool.state.activeTool, { name: "read_file", args: { path: "README.md" } })
  assert.deepEqual(tool.effects, { flushPendingTools: false, commitAssistant: true })

  const retry = reduceLiveTranscript(tool.state, { protocolVersion: 1, turnId: "turn-1", type: "model.retrying", step: 1, attempt: 2, delayMs: 1500 }, "zh")
  assert.equal(retry.state.activeTool, "正在重试第 2 次 · 2 秒后")

  const completed = reduceLiveTranscript({ ...retry.state, liveAssistant: "final" }, { protocolVersion: 1, turnId: "turn-1", type: "turn.completed", output: "final" }, "en")
  assert.equal(completed.state.liveAssistant, "")
  assert.deepEqual(completed.effects, { flushPendingTools: true, commitAssistant: true })
})

test("transcript owner handles synchronous streaming and tool events from one snapshot", () => {
  const owner = createTranscriptOwner([])
  const base = { protocolVersion: 1 as const, turnId: "turn-owner", step: 1 }
  owner.handleEvent({ ...base, type: "turn.started", input: "build" }, "en")
  owner.handleEvent({ ...base, type: "message.delta", delta: "Ready.\n\n" }, "en")
  owner.handleEvent({ ...base, type: "tool.started", callId: "shell-owner", name: "shell", args: { command: "npm test" } }, "en")
  owner.handleEvent({ ...base, type: "tool.completed", callId: "shell-owner", name: "shell", ok: true, output: "passed" }, "en")
  owner.handleEvent({ ...base, type: "step.started", step: 2 }, "en")

  const snapshot = owner.getSnapshot()
  assert.deepEqual(snapshot.items.map((item) => item.kind), ["assistant", "tool"])
  assert.equal(snapshot.items[0]?.kind === "assistant" ? snapshot.items[0].text : "", "Ready.\n\n")
  assert.deepEqual(snapshot.items[1]?.kind === "tool" ? snapshot.items[1].tools[0]?.args : undefined, { command: "npm test" })
  assert.equal(snapshot.pendingToolGroup, null)
  assert.equal(snapshot.liveAssistant, "")
  assert.equal(owner.hasAssistantOutput(), true)
  owner.destroy()
})

test("transcript owner reports no assistant output until a stream is committed", () => {
  const owner = createTranscriptOwner([])
  assert.equal(owner.hasAssistantOutput(), false)
  owner.handleEvent({ protocolVersion: 1, turnId: "turn-empty", type: "turn.started", input: "empty" }, "en")
  owner.handleEvent({ protocolVersion: 1, turnId: "turn-empty", type: "turn.completed", output: "fallback" }, "en")
  assert.equal(owner.hasAssistantOutput(), false)
  owner.destroy()
})

test("slash command router separates builtins, extensions, arguments, and plain prompts", () => {
  assert.deepEqual(routeSlashCommand("/status"), { kind: "builtin", command: "status", argument: "" })
  assert.deepEqual(routeSlashCommand(" /review  focus on tests  ", ["review"]), { kind: "extension", command: "review", argument: "focus on tests" })
  assert.deepEqual(routeSlashCommand("/unknown value"), { kind: "unknown", command: "unknown", argument: "value" })
  assert.deepEqual(routeSlashCommand("inspect the project", ["review"]), { kind: "none" })
  assert.equal(slashCommandName("/language zh"), "language")
  assert.equal(slashCommandName("plain task"), undefined)
})

test("session action models keep matching and command argument rules pure", () => {
  const sessions = [
    { id: "abc", title: "Deploy API", workspace: "/tmp", updatedAt: "2026-01-02", directory: "/tmp/abc" },
    { id: "def", title: "API tests", workspace: "/tmp", updatedAt: "2026-01-01", directory: "/tmp/def" },
  ]
  assert.deepEqual(matchSessionQuery(sessions, "abc").map((session) => session.id), ["abc"])
  assert.deepEqual(matchSessionQuery(sessions, "api").map((session) => session.id), ["abc", "def"])
  assert.equal(parseRewindMode(""), "both")
  assert.equal(parseRewindMode("chat"), "chat")
  assert.equal(parseRewindMode("invalid"), undefined)
  assert.deepEqual(parseExportArguments("json ./out.json"), { format: "json", output: "./out.json" })
  assert.deepEqual(parseExportArguments(""), { format: "md" })
  assert.equal(parseExportArguments("yaml"), undefined)
})

test("model action models normalize presets, effort, thinking, and runtime state", () => {
  assert.equal(modelPresetArgument("  openai/gpt  "), "openai/gpt")
  assert.equal(parseReasoningEffort("high"), "high")
  assert.equal(parseReasoningEffort("invalid"), undefined)
  assert.equal(parseThinkingMode("off"), "off")
  assert.equal(parseThinkingMode("invalid"), undefined)
  assert.equal(nextReasoningEffort("default"), "low")
  assert.deepEqual(modelStateFromConfig({ preset: "test", reasoningEffort: "high", thinkingMode: "on", effectiveReasoningEffort: "medium", effectiveThinkingMode: "on" } as any), {
    model: "test", effort: "high", thinkingMode: "on", effectiveEffort: "medium", effectiveThinkingMode: "on",
  })
})

test("dialog coordinator centralizes blocking and visibility decisions", () => {
  const idle: ActiveDialog = { kind: "none" }
  assert.equal(hasBlockingDialog(idle), false)
  assert.equal(showInteractiveComposer(idle), true)
  assert.equal(showRunningActivity(idle), true)
  assert.equal(canOpenHelp(idle), true)
  assert.equal(canOpenTranscriptViewer(idle), true)

  const help: ActiveDialog = { kind: "help", offset: 0 }
  assert.equal(hasBlockingDialog(help), true)
  assert.equal(showInteractiveComposer(help), false)
  assert.equal(showRunningActivity(help), false)

  const approval: ActiveDialog = { kind: "approval", request: { tool: "shell", args: {}, reason: "test", risk: "low", resolve: () => {} } as any, selectedIndex: 0 }
  assert.equal(canOpenHelp(approval), false)
  assert.equal(canOpenTranscriptViewer(approval), false)
})
