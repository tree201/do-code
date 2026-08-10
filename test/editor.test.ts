import assert from "node:assert/strict"
import test from "node:test"
import { applyCompletion, buildWorkspaceCompletionIndex, builtinCommandCompletions, completionsForEditor } from "../src/ui/completion.js"
import { t } from "../src/ui/i18n.js"
import {
  backspaceEditor,
  createEditor,
  editorCursorParts,
  insertEditorText,
  moveEditorCursor,
  moveEditorVertical,
  redoEditor,
  replaceEditorRange,
  undoEditor,
} from "../src/ui/editor.js"

test("editor moves and deletes whole Unicode graphemes", () => {
  let editor = createEditor("你👨‍💻好")
  editor = moveEditorCursor(editor, -1)
  assert.deepEqual(editorCursorParts(editor), { before: "你👨‍💻", cursor: "好", after: "" })
  editor = backspaceEditor(editor)
  assert.equal(editor.value, "你好")
  assert.equal(editor.cursor, 1)
})

test("editor supports insertion in the middle and multiline vertical movement", () => {
  let editor = createEditor("ab\n1234")
  editor = moveEditorCursor(editor, -2)
  editor = moveEditorVertical(editor, -1)
  assert.equal(editor.cursor, 2)
  editor = insertEditorText(editor, "中")
  assert.equal(editor.value, "ab中\n1234")
})

test("editor supports undo, redo and range completion", () => {
  let editor = insertEditorText(createEditor(), "/he")
  editor = replaceEditorRange(editor, 0, 3, "/help ")
  assert.equal(editor.value, "/help ")
  editor = undoEditor(editor)
  assert.equal(editor.value, "/he")
  editor = redoEditor(editor)
  assert.equal(editor.value, "/help ")
})

test("completion provides slash commands and workspace file references", () => {
  const slash = completionsForEditor(createEditor("/st"), [])
  assert.equal(slash?.items[0]?.label, "/status")

  const file = completionsForEditor(createEditor("看看 @chat"), ["src/ui/chat-app.tsx", "README.md"])
  assert.equal(file?.items[0]?.insert, "@src/ui/chat-app.tsx")

  const directory = completionsForEditor(createEditor("@src/"), ["src/ui/chat-app.tsx"])
  assert.equal(directory?.items[0]?.insert, "@src/ui/")

  assert.equal(applyCompletion(createEditor("/st"), []).value, "/status")
  assert.equal(completionsForEditor(createEditor("/resu"), [])?.items[0]?.submit, true)
})

test("file completion works directly after Chinese text without matching email addresses", () => {
  const files = ["README.md", "src/main.ts"]
  const completion = completionsForEditor(createEditor("请输入@"), files)
  assert.equal(completion?.items[0]?.label, "@src/")
  assert.equal(applyCompletion(createEditor("请输入@"), files).value, "请输入@src/")
  assert.equal(completionsForEditor(createEditor("name@"), files), null)
  assert.equal(completionsForEditor(createEditor("name@example"), files), null)
})

test("completion supports executable second-level command choices", () => {
  const argumentsByCommand = {
    "/model": [
      { label: "ark/glm-5.2", description: "Current model", insert: "ark/glm-5.2", submit: true },
      { label: "ark/doubao", description: "Switch model", insert: "ark/doubao", submit: true },
    ],
  }
  const choices = completionsForEditor(createEditor("/model "), [], [], argumentsByCommand)
  assert.deepEqual(choices?.items.map((item) => item.label), ["ark/glm-5.2", "ark/doubao"])
  assert.equal(applyCompletion(createEditor("/model ar"), [], 1, [], argumentsByCommand).value, "/model ark/doubao")
  assert.equal(choices?.items[0]?.submit, true)
})

test("model selection uses the dedicated dialog instead of model list completion", () => {
  const editor = createEditor("/model ")
  const argumentCompletions = {
    "/effort": [{ label: "low", description: "Low", insert: "low", submit: true }],
  }
  assert.equal(completionsForEditor(editor, [], [], argumentCompletions), null)
})

test("file completion hides do-code artifacts and prioritizes workspace roots", () => {
  const files = [
    ".do-code/checkpoints/session/cp.json",
    "node_modules/pkg/index.js",
    "src/ui/app.ts",
    "src/main.ts",
    "package.json",
    "README.md",
  ]
  const completion = completionsForEditor(createEditor("@"), files)
  assert.deepEqual(completion?.items.map((item) => item.label), ["@src/", "@package.json", "@README.md", "@src/ui/", "@src/main.ts", "@src/ui/app.ts"])
  assert.ok(completion?.items.every((item) => !item.label.includes(".do-code") && !item.label.includes("node_modules")))
})

test("workspace completion index is reusable across editor queries", () => {
  const files = ["src/main.ts", "src/ui/app.tsx", "README.md"]
  const index = buildWorkspaceCompletionIndex(files)
  assert.equal(completionsForEditor(createEditor("@s"), files, [], {}, "en", index)?.items[0]?.label, "@src/")
  assert.match(completionsForEditor(createEditor("@src/"), files, [], {}, "en", index)?.items[0]?.label ?? "", /^@src\//)
})

test("Chinese completion explains every built-in command and workspace file action", () => {
  const commands = builtinCommandCompletions("zh")
  assert.equal(commands.find((item) => item.label === "/plan")?.description, "进入只读规划模式或开始制定目标计划")
  assert.equal(commands.find((item) => item.label === "/effort")?.description, "查看或切换思考强度")
  assert.ok(commands.every((item) => !/^(Show|View|Capture|Restore|Rewind|Compact|Trust|Enter|Clear|Browse|Rename|Export|Save)\b/.test(item.description)))

  const files = completionsForEditor(createEditor("@"), ["src/main.ts"], [], {}, "zh")
  assert.equal(files?.items.find((item) => item.label === "@src/")?.description, "继续浏览此目录")
  assert.equal(files?.items.find((item) => item.label === "@src/main.ts")?.description, "添加文件到上下文")

  assert.equal(t("zh", "Current reasoning effort"), "当前思考强度")
  assert.equal(t("zh", "Reload instructions from disk"), "从磁盘重新加载指令")
  assert.equal(t("zh", "Rewind conversation and files"), "同时回退对话和文件")
  assert.equal(t("zh", "Export the session as Markdown"), "将会话导出为 Markdown")
})
