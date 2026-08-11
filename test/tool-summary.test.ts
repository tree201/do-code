import assert from "node:assert/strict"
import test from "node:test"
import { activeToolSummary, buildToolGroupSummary } from "../src/ui/tool-summary.js"
import { approvalModeNotice, composerStatusText } from "../src/ui/chat-app.js"
import { buildActivitySummary } from "../src/ui/activity-summary.js"
import { activityGroupKey, createToolPresentation } from "../src/tool-presentation.js"

test("tool summaries describe actions and targets instead of leaking raw output", () => {
  const summary = buildToolGroupSummary([
    { name: "read_file", args: { path: "src/main.ts" }, ok: true, output: "1: import secret from './secret'" },
    { name: "read_file", args: { path: "src/config.ts" }, ok: true, output: "1: export const token = 'hidden'" },
  ], "zh")
  assert.equal(summary, "已读取文件 2 次  src/main.ts、src/config.ts")
  assert.doesNotMatch(summary, /import|token|hidden/)
})

test("active tool summaries use a concise localized verb", () => {
  assert.equal(activeToolSummary("search", { query: "permission", path: "src" }, "zh"), "正在搜索  “permission”  src")
  assert.equal(activeToolSummary("edit_file", { path: "src/app.ts" }, "en"), "Editing  src/app.ts")
})

test("composer status progressively removes metadata in narrow terminals", () => {
  const base = { language: "zh" as const, running: true, command: false, model: "ark/glm-5.2", contextPercent: 23, approvalMode: "full-access" as const }
  assert.equal(composerStatusText({ ...base, width: 100 }), "glm-5.2 · 默认 · 23%")
  assert.equal(composerStatusText({ ...base, width: 64 }), "glm-5.2 · 默认 · 23%")
  assert.equal(composerStatusText({ ...base, width: 38 }), "glm-5.2 · 默认 · 23%")
  assert.equal(composerStatusText({ ...base, width: 28 }), "glm-5.2 · 默认 · 23%")
  assert.equal(composerStatusText({ ...base, width: 18 }), "glm-5.2 · 23%")
  assert.equal(composerStatusText({ ...base, language: "en", reasoningIntensity: "high", width: 100 }), "glm-5.2 · high · 23%")
  assert.equal(composerStatusText({ ...base, planMode: true, width: 100 }), "glm-5.2 · 默认 · 23%")
})

test("approval mode switches explain every mode in Chinese and English", () => {
  assert.match(approvalModeNotice("ask", "zh"), /当前工作区.*联网.*请求确认/)
  assert.match(approvalModeNotice("ask", "en"), /current-workspace.*ask before network/i)
  assert.match(approvalModeNotice("auto", "zh"), /普通编辑.*联网.*可能不安全/)
  assert.match(approvalModeNotice("full-access", "en"), /outside the workspace.*catastrophic system commands remain blocked/i)
})

test("activity summaries group exploration into a user-facing outline", () => {
  const items = [
    { name: "read_file", args: { path: "src/main.ts" }, ok: true, output: "source", presentation: createToolPresentation("read_file", { path: "src/main.ts" }, { ok: true, output: "source" }, 12) },
    { name: "search", args: { path: "src", query: "createApp" }, ok: true, output: "src/main.ts:10:createApp()", presentation: createToolPresentation("search", { path: "src", query: "createApp" }, { ok: true, output: "src/main.ts:10:createApp()" }, 8) },
  ]
  const summary = buildActivitySummary(items, "zh")
  assert.equal(summary.title, "检查了项目")
  assert.match(summary.lines.map((line) => line.text).join("\n"), /src\/main\.ts/)
  assert.match(summary.lines.map((line) => line.text).join("\n"), /createApp/)
  assert.equal(activityGroupKey("read_file"), activityGroupKey("search"))
})

test("activity summaries expose compact edit stats and command excerpts", () => {
  const edit = createToolPresentation("edit_file", { path: "src/app.ts", old_text: "old", new_text: "new\nline" }, { ok: true, output: "done" }, 20)
  const editSummary = buildActivitySummary([{ name: "edit_file", args: {}, ok: true, output: "done", presentation: edit }], "en")
  assert.equal(editSummary.title, "Edited 1 file (+2 -1)")
  const editDiff = editSummary.diffs?.[0]
  assert.equal(editDiff?.path, "src/app.ts")
  assert.deepEqual(editDiff?.lines.map((line) => [line.kind, line.text]), [
    ["remove", "old"],
    ["add", "new"],
    ["add", "line"],
  ])

  const command = createToolPresentation("shell", { command: "npm run build" }, { ok: true, output: "line one\nline two\n✓ built in 1.29s" }, 1290)
  const commandSummary = buildActivitySummary([{ name: "shell", args: {}, ok: true, output: "raw", presentation: command }], "en")
  assert.equal(commandSummary.title, "Ran npm run build")
  assert.match(commandSummary.lines.map((line) => line.text).join("\n"), /built in 1\.29s/)
  assert.match(commandSummary.lines.map((line) => line.text).join("\n"), /Duration 1\.29s/)
})

test("large and failed edits keep every changed line", () => {
  const oldText = Array.from({ length: 4 }, (_, index) => `old-${index + 1}`).join("\n")
  const newText = Array.from({ length: 17 }, (_, index) => `new-${index + 1}`).join("\n")
  const large = createToolPresentation("edit_file", { path: "src/main.js", old_text: oldText, new_text: newText }, { ok: true, output: "done" }, 15)
  const summary = buildActivitySummary([{ name: "edit_file", args: {}, ok: true, output: "done", presentation: large }], "zh")
  assert.equal(summary.title, "已编辑 1 个文件 (+17 -4)")
  const diff = summary.diffs?.[0]
  assert.equal(diff?.path, "src/main.js")
  assert.equal(diff?.lines[0]?.kind, "remove")
  assert.equal(diff?.lines[0]?.text, "old-1")
  assert.ok(diff?.lines.some((line) => line.kind === "add" && line.text === "new-1"))
  assert.equal(diff?.omitted, 0)
  assert.equal(diff?.lines.length, 21)
  assert.ok(diff?.lines.some((line) => line.kind === "add" && line.text === "new-17"))

  const failed = createToolPresentation("edit_file", { path: "src/main.js", old_text: "before", new_text: "after" }, { ok: false, output: "old_text was not found" }, 10)
  assert.equal(failed.fileChanges, undefined)
  const failedSummary = buildActivitySummary([{ name: "edit_file", args: {}, ok: false, output: "old_text was not found", presentation: failed }], "en")
  assert.equal(failedSummary.title, "Edit failed")
  assert.match(failedSummary.lines.map((line) => line.text).join("\n"), /old_text was not found/)
  assert.equal(failedSummary.diffs, undefined)
})

test("failed edit attempts from older sessions do not pollute successful diff stats", () => {
  const failed = createToolPresentation("edit_file", { path: "src/main.js", old_text: "missing\nblock", new_text: "attempted\nreplacement\nblock" }, { ok: false, output: "old_text was not found" }, 10)
  // Old persisted sessions contain this fallback shape without line numbers.
  failed.fileChanges = [{
    path: "src/main.js",
    additions: 3,
    deletions: 2,
    diffLines: [
      { kind: "remove", text: "missing" },
      { kind: "remove", text: "block" },
      { kind: "add", text: "attempted" },
      { kind: "add", text: "replacement" },
      { kind: "add", text: "block" },
    ],
  }]
  const succeeded = createToolPresentation("edit_file", { path: "src/main.js", old_text: "before", new_text: "after" }, { ok: true, output: "Edited src/main.js" }, 10)
  succeeded.fileChanges![0]!.diffLines = [
    { kind: "remove", text: "before", oldLine: 12 },
    { kind: "add", text: "after", newLine: 12 },
  ]

  const summary = buildActivitySummary([
    { name: "edit_file", ok: false, output: "old_text was not found", presentation: failed },
    { name: "edit_file", ok: true, output: "Edited src/main.js", presentation: succeeded },
  ], "en")

  assert.equal(summary.title, "Edited 1 file (+1 -1)")
  assert.deepEqual(summary.diffs?.[0]?.lines.map((line) => [line.oldLine, line.newLine, line.text]), [
    [12, undefined, "before"],
    [undefined, 12, "after"],
  ])
  assert.match(summary.lines.map((line) => line.text).join("\n"), /old_text was not found/)
})

test("new files expose numbered added lines instead of only a total", () => {
  const presentation = createToolPresentation("write_file", { path: "src/new.ts", content: "first\nsecond" }, { ok: true, output: "done" }, 4)
  const summary = buildActivitySummary([{ name: "write_file", args: {}, ok: true, output: "done", presentation }], "en")
  assert.equal(summary.title, "Edited 1 file (+2 -0)")
  assert.deepEqual(summary.diffs?.[0]?.lines.map((line) => [line.newLine, line.kind, line.text]), [
    [1, "add", "first"],
    [2, "add", "second"],
  ])
})

test("activity summaries localize fixed command and line-count fallbacks", () => {
  const command = createToolPresentation("shell", {}, { ok: true, output: "" }, 0)
  const summary = buildActivitySummary([{ name: "shell", args: {}, ok: true, output: "", presentation: command }], "ja")
  assert.equal(summary.title, "コマンド を実行")

  const file = createToolPresentation("edit_file", { path: "src/main.ts" }, { ok: true, output: "" }, 0)
  file.fileChanges = [{ path: "src/main.ts", lines: 3 }]
  const fileSummary = buildActivitySummary([{ name: "edit_file", args: {}, ok: true, output: "", presentation: file }], "fr")
  assert.equal(fileSummary.diffs?.[0]?.stats, " (3 lignes)")
})
