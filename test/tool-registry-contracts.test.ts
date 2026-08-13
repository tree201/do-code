import assert from "node:assert/strict"
import test from "node:test"
import { executeTool, toolDefinitions } from "../src/tools.js"

const BUILT_IN_TOOL_ORDER = [
  "web_fetch",
  "web_search",
  "delegate_task",
  "list_directory",
  "glob",
  "read_file",
  "read_many_files",
  "search",
  "write_file",
  "edit_file",
  "memory_list",
  "memory_read",
  "memory_write",
  "memory_delete",
  "enter_plan_mode",
  "exit_plan_mode",
  "ask_user",
  "todo_write",
  "todo_read",
  "apply_patch",
  "shell",
  "shell_start",
  "shell_pty_start",
  "shell_status",
  "shell_send",
  "shell_resize",
  "shell_stop",
]

test("built-in tool registry preserves the complete public order", () => {
  assert.deepEqual(toolDefinitions.map((definition) => definition.function.name), BUILT_IN_TOOL_ORDER)
})

test("unknown tools fail without consulting policy or approval callbacks", async () => {
  let approvals = 0
  const result = await executeTool("missing_tool", {}, {
    workspace: process.cwd(),
    approveShell: async () => { approvals += 1; return true },
    approveTool: async () => { approvals += 1; return true },
  })
  assert.deepEqual(result, { ok: false, output: "Unknown tool: missing_tool" })
  assert.equal(approvals, 0)
})
