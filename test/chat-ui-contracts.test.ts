import assert from "node:assert/strict"
import test from "node:test"
import type { ToolApprovalRequest } from "../src/policy.js"
import type { PlanProposal } from "../src/tools.js"
import { ApprovalBridge, PlanReviewBridge, QuestionBridge } from "../src/ui/async-bridges.js"
import { canRunSlashCommandDuringTask } from "../src/ui/shortcut-command-policy.js"
import { createPausableOutput } from "../src/ui/pausable-output.js"
import { acceptAttachments, attachmentIndex } from "../src/ui/attachment-model.js"
import { turnSubmissionDisposition } from "../src/ui/turn-submission-model.js"
import { cachedTranscriptViewerLines, cachedTranscriptViewerText } from "../src/ui/transcript-viewer-cache.js"
import type { TranscriptItem } from "../src/ui/transcript-model.js"
import { createLiveAssistantPublisher } from "../src/ui/live-assistant-publisher.js"
import { LiveOutputViewport } from "../src/ui/live-output-viewport.js"
import { boundedLiveOutput } from "../src/ui/chat-presentation.js"
import { splitStreamingMarkdown } from "../src/ui/streaming-markdown.js"
import { createComposerOwner } from "../src/ui/composer-owner.js"
import { createEditor } from "../src/ui/editor.js"
import { createRuntimeStore } from "../src/ui/runtime-store.js"
import { createTurnOwner } from "../src/ui/turn-owner.js"

const approvalRequest: ToolApprovalRequest = {
  tool: "shell",
  title: "Run command",
  detail: "npm test",
  args: { command: "npm test" },
  decision: "ask",
  risk: "medium",
  reason: "Shell commands require approval",
  matchedRule: "mode.default",
  dangerous: false,
}

const plan: PlanProposal = {
  title: "Extract UI leaves",
  summary: "Move independent UI contracts out of the main application module.",
  steps: ["Extract bridges"],
  files: ["src/ui/chat-app.tsx"],
  verification: ["Run focused tests"],
  risks: ["Preserve compatibility exports"],
}

test("async bridges provide safe answers when no UI handler is attached", async () => {
  assert.equal(await new ApprovalBridge().request(approvalRequest), "deny")
  assert.equal(await new QuestionBridge().request("Continue?"), "User input is unavailable")
  assert.equal(await new PlanReviewBridge().request(plan), "cancel")
})

test("async bridges resolve requests through the currently attached UI handler", async () => {
  const approvals = new ApprovalBridge()
  approvals.attach((request) => {
    assert.equal(request.tool, "shell")
    request.resolve("session")
  })
  assert.equal(await approvals.request(approvalRequest), "session")

  const questions = new QuestionBridge()
  questions.attach((request) => {
    assert.deepEqual(request.options, ["Tests", "Types"])
    request.resolve("Types")
  })
  assert.equal(await questions.request("What next?", ["Tests", "Types"]), "Types")

  const plans = new PlanReviewBridge()
  plans.attach((request) => {
    assert.equal(request.plan.title, plan.title)
    request.resolve("revise")
  })
  assert.equal(await plans.request(plan), "revise")
})

test("running tasks allow only non-mutating control commands and bare model selection", () => {
  for (const command of [
    "/help", "/status", "/stats", "/permissions", "/approval-mode", "/trust",
    "/untrust", "/extensions", "/language", "/exit", "/quit", "/model",
  ]) assert.equal(canRunSlashCommandDuringTask(`  ${command}  `), true, command)

  assert.equal(canRunSlashCommandDuringTask("/model next-model"), false)
  assert.equal(canRunSlashCommandDuringTask("/resume"), false)
  assert.equal(canRunSlashCommandDuringTask("/export json"), false)
  assert.equal(canRunSlashCommandDuringTask("ordinary message"), false)
})

test("pausable output forwards normally, buffers while paused, and replays atomically", async () => {
  const writes: Array<string | Uint8Array> = []
  const target = {
    write(chunk: string | Uint8Array) {
      writes.push(chunk)
      return true
    },
  } as unknown as NodeJS.WriteStream
  const output = createPausableOutput(target)
  const write = output.stdout.write as unknown as (...args: unknown[]) => boolean

  write("before")
  output.pause()
  let callbackCalled = false
  write("queued", "utf8", () => { callbackCalled = true })
  write(new Uint8Array([33]))
  assert.deepEqual(writes, ["before"])
  assert.equal(callbackCalled, false)
  await Promise.resolve()
  assert.equal(callbackCalled, true)

  output.resume()
  assert.deepEqual(writes, ["before", "\u001b[?2026h", "queued", new Uint8Array([33]), "\u001b[?2026l"])

  output.pause()
  write("discarded")
  output.resume(false)
  assert.equal(writes.includes("discarded"), false)
})

test("turn submission distinguishes empty input, queued prompts, and concurrent commands", () => {
  assert.equal(turnSubmissionDisposition("", 0, false), "ignore")
  assert.equal(turnSubmissionDisposition("", 1, false), "execute")
  assert.equal(turnSubmissionDisposition("next task", 0, true), "queue")
  assert.equal(turnSubmissionDisposition("/status", 0, true), "execute")
  assert.equal(turnSubmissionDisposition("/model provider/model", 0, true), "queue")
})

test("attachment model resolves index/name references and accepts only byte-safe images", () => {
  const current = [{ reference: "attachments/one.png", name: "one.png", size: 4 }]
  assert.equal(attachmentIndex(current, "1"), 0)
  assert.equal(attachmentIndex(current, "one.png"), 0)
  assert.equal(attachmentIndex(current, "missing.png"), -1)
  assert.deepEqual(acceptAttachments(current, [
    { reference: "attachments/two.png", name: "two.png", size: 5 },
    { reference: "attachments/large.png", name: "large.png", size: 20 },
    { reference: "attachments/three.png", name: "three.png", size: 1 },
  ], 10), {
    accepted: [
      { reference: "attachments/two.png", name: "two.png", size: 5 },
      { reference: "attachments/three.png", name: "three.png", size: 1 },
    ],
    skipped: 1,
    totalBytes: 10,
  })
})

test("transcript viewer cache reuses immutable snapshots and invalidates by view inputs", () => {
  const items: TranscriptItem[] = [{ id: 1, kind: "assistant", text: "cached history" }]
  assert.strictEqual(cachedTranscriptViewerText(items, "en"), cachedTranscriptViewerText(items, "en"))
  const narrow = cachedTranscriptViewerLines(items, "en", 12)
  assert.strictEqual(narrow, cachedTranscriptViewerLines(items, "en", 12))
  assert.notStrictEqual(narrow, cachedTranscriptViewerLines(items, "en", 24))
  assert.notStrictEqual(narrow, cachedTranscriptViewerLines(items, "zh", 12))
  assert.notStrictEqual(narrow, cachedTranscriptViewerLines([...items], "en", 12))
})

test("live assistant publisher coalesces bursts and cancels stale scheduled output", () => {
  const published: string[] = []
  const scheduled: Array<() => void> = []
  const cancelled = new Set<number>()
  const publisher = createLiveAssistantPublisher((value) => published.push(value), (publish) => {
    const index = scheduled.push(publish) - 1
    return () => { cancelled.add(index) }
  })

  publisher.schedule("one")
  publisher.schedule("one two")
  publisher.schedule("one two three")
  assert.equal(scheduled.length, 1)
  assert.deepEqual(published, [])
  scheduled[0]?.()
  assert.deepEqual(published, ["one two three"])

  publisher.schedule("stale")
  publisher.flush("final")
  assert.deepEqual(published, ["one two three", "final"])
  assert.equal(cancelled.has(1), true)
  scheduled[1]?.()
  assert.deepEqual(published, ["one two three", "final"])
})

test("live output viewport incrementally matches bounded terminal output", () => {
  const viewport = new LiveOutputViewport(12, 4)
  const chunks = ["first line\n", "中文中文中文", "\nlast ", "😀 line"]
  for (const chunk of chunks) viewport.append(chunk)
  const full = chunks.join("")
  assert.deepEqual(viewport.value(), boundedLiveOutput(full, 12, 4))
  viewport.reset(full, 18, 3)
  assert.deepEqual(viewport.value(), boundedLiveOutput(full, 18, 3))
})

test("streaming markdown commits complete blocks while retaining the unfinished tail", () => {
  const first = splitStreamingMarkdown("# Result\n\nA complete paragraph.\n\n- pending")
  assert.equal(first.stable, "# Result\n\nA complete paragraph.\n\n")
  assert.equal(first.pending, "- pending")

  const secondSource = "# Result\n\nA complete paragraph.\n\n- pending\n- complete\n\nNext"
  const second = splitStreamingMarkdown(secondSource, first.committedLength)
  assert.equal(second.stable, "- pending\n- complete\n\n")
  assert.equal(second.pending, "Next")
  assert.equal(secondSource.slice(0, second.committedLength), first.stable + second.stable)
})

test("streaming markdown keeps a loose list together until the complete list boundary", () => {
  const looseList = splitStreamingMarkdown("- first item\n\n- second item")
  assert.equal(looseList.stable, "")
  assert.equal(looseList.pending, "- first item\n\n- second item")

  const completed = splitStreamingMarkdown("- first item\n\n- second item\n\nNext block")
  assert.equal(completed.stable, "- first item\n\n- second item\n\n")
  assert.equal(completed.pending, "Next block")
})

test("streaming markdown never commits inside an open fenced code block", () => {
  const open = splitStreamingMarkdown("Intro\n\n```ts\nconst value = 1\n\n")
  assert.equal(open.stable, "Intro\n\n")
  assert.equal(open.pending, "```ts\nconst value = 1\n\n")

  const closed = splitStreamingMarkdown("Intro\n\n```ts\nconst value = 1\n\n```\nTail", open.committedLength)
  assert.equal(closed.stable, "```ts\nconst value = 1\n\n```\n")
  assert.equal(closed.pending, "Tail")
})

test("composer owner applies synchronous edits without state-ref mirrors", () => {
  const owner = createComposerOwner()
  owner.setCompletionIndex(4)
  owner.setEditor(createEditor("draft"))
  owner.setEditor((current) => ({ ...current, value: `${current.value}!`, cursor: current.cursor + 1 }))
  owner.setAttachments([{ reference: "attachments/a.png", name: "a.png", size: 10 }])
  owner.setQueuedInputs(["next"])
  const snapshot = owner.getSnapshot()
  assert.equal(snapshot.editor.value, "draft!")
  assert.equal(snapshot.completionIndex, 0)
  assert.equal(snapshot.attachments[0]?.name, "a.png")
  assert.deepEqual(snapshot.queuedInputs, ["next"])
  owner.destroy()
})

test("turn owner exposes one synchronous running and abort lifecycle", () => {
  const owner = createTurnOwner()
  const signal = owner.begin()
  assert.equal(owner.getSnapshot().running, true)
  owner.abort()
  assert.equal(signal.aborted, true)
  owner.finish()
  assert.equal(owner.getSnapshot().running, false)
  owner.destroy()
})

test("runtime store owns model, session, language, approval, and plan state", async () => {
  const modelConfig = { source: "config" as const, sourceLabel: "test", preset: "test/a", provider: "test", modelId: "a", baseUrl: "https://example.com", apiKey: "hidden", reasoningEffort: "low" as const, thinkingMode: "auto" as const }
  const session = { id: "session_a", workspace: "/tmp", model: "test/a", createdAt: "now", updatedAt: "now", directory: "/tmp/session_a" }
  const store = createRuntimeStore({ session, modelConfig, modelPresets: ["test/a"], approvalMode: "ask", planMode: false, language: "en" }, {
    switchModel: async (preset, effort, thinking) => ({ ...modelConfig, preset, modelId: preset.split("/").at(-1)!, ...(effort ? { reasoningEffort: effort } : {}), ...(thinking ? { thinkingMode: thinking } : {}) }),
    setLanguage: async () => {}, setApprovalMode: () => {}, setPlanMode: () => {},
    resumeSession: async () => ({ session: { ...session, id: "session_b", directory: "/tmp/session_b" }, messages: [], events: [] }),
  })
  await store.switchEffort("high")
  store.setApprovalMode("full-access")
  store.setPlanMode(true)
  await store.setLanguage("zh")
  await store.resumeSession("session_b")
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.modelConfig.reasoningEffort, "high")
  assert.equal(snapshot.approvalMode, "full-access")
  assert.equal(snapshot.planMode, true)
  assert.equal(snapshot.language, "zh")
  assert.equal(snapshot.session.id, "session_b")
})

test("runtime store restores a session model before publishing the resumed session", async () => {
  const modelConfig = { source: "config" as const, sourceLabel: "test", preset: "test/a", provider: "test", modelId: "a", baseUrl: "https://example.com", apiKey: "hidden" }
  const session = { id: "session_a", workspace: "/tmp", model: "test/a", createdAt: "now", updatedAt: "now", directory: "/tmp/session_a" }
  const switched: string[] = []
  const store = createRuntimeStore({ session, modelConfig, modelPresets: ["test/a", "test/b"], approvalMode: "ask", planMode: false, language: "en" }, {
    switchModel: async (preset) => { switched.push(preset); return { ...modelConfig, preset, modelId: preset.split("/").at(-1)! } },
    resumeSession: async () => ({ session: { ...session, id: "session_b", model: "test/b", directory: "/tmp/session_b" }, messages: [], events: [] }),
  })
  await store.resumeSession("session_b")
  assert.deepEqual(switched, ["test/b"])
  assert.equal(store.getSnapshot().modelConfig.preset, "test/b")
  assert.equal(store.getSnapshot().session.id, "session_b")
})

test("runtime store resumes history when its recorded model is no longer available", async () => {
  const modelConfig = { source: "config" as const, sourceLabel: "test", preset: "test/current", provider: "test", modelId: "current", baseUrl: "https://example.com", apiKey: "hidden" }
  const session = { id: "session_a", workspace: "/tmp", model: "test/current", createdAt: "now", updatedAt: "now", directory: "/tmp/session_a" }
  const store = createRuntimeStore({ session, modelConfig, modelPresets: ["test/current"], approvalMode: "ask", planMode: false, language: "en" }, {
    restoreModel: async () => { throw new Error("Unknown model preset") },
    resumeSession: async () => ({ session: { ...session, id: "session_old", model: "test/removed", directory: "/tmp/session_old" }, messages: [], events: [] }),
  })
  await store.resumeSession("session_old")
  assert.equal(store.getSnapshot().modelConfig.preset, "test/current")
  assert.equal(store.getSnapshot().session.id, "session_old")
})
