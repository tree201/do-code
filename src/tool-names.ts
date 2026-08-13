export const WEB_FETCH_TOOL = "web_fetch"
export const WEB_SEARCH_TOOL = "web_search"
export const DELEGATE_TASK_TOOL = "delegate_task"
export const LIST_DIRECTORY_TOOL = "list_directory"
export const GLOB_TOOL = "glob"
export const READ_FILE_TOOL = "read_file"
export const READ_MANY_FILES_TOOL = "read_many_files"
export const SEARCH_TOOL = "search"
export const WRITE_FILE_TOOL = "write_file"
export const EDIT_FILE_TOOL = "edit_file"
export const ENTER_PLAN_MODE_TOOL = "enter_plan_mode"
export const EXIT_PLAN_MODE_TOOL = "exit_plan_mode"
export const ASK_USER_TOOL = "ask_user"
export const TODO_WRITE_TOOL = "todo_write"
export const TODO_READ_TOOL = "todo_read"
export const MEMORY_LIST_TOOL = "memory_list"
export const MEMORY_READ_TOOL = "memory_read"
export const MEMORY_WRITE_TOOL = "memory_write"
export const MEMORY_DELETE_TOOL = "memory_delete"
export const APPLY_PATCH_TOOL = "apply_patch"
export const SHELL_TOOL = "shell"
export const SHELL_START_TOOL = "shell_start"
export const SHELL_PTY_START_TOOL = "shell_pty_start"
export const SHELL_STATUS_TOOL = "shell_status"
export const SHELL_SEND_TOOL = "shell_send"
export const SHELL_RESIZE_TOOL = "shell_resize"
export const SHELL_STOP_TOOL = "shell_stop"
export const MCP_SERVER_TOOL = "mcp_server"
export const MCP_TOOL_PREFIX = "mcp__"
export const HOOK_TOOL_PREFIX = "hook__"

export const TOOL_NAMES = {
  WEB_FETCH: WEB_FETCH_TOOL,
  WEB_SEARCH: WEB_SEARCH_TOOL,
  DELEGATE_TASK: DELEGATE_TASK_TOOL,
  LIST_DIRECTORY: LIST_DIRECTORY_TOOL,
  GLOB: GLOB_TOOL,
  READ_FILE: READ_FILE_TOOL,
  READ_MANY_FILES: READ_MANY_FILES_TOOL,
  SEARCH: SEARCH_TOOL,
  WRITE_FILE: WRITE_FILE_TOOL,
  EDIT_FILE: EDIT_FILE_TOOL,
  ENTER_PLAN_MODE: ENTER_PLAN_MODE_TOOL,
  EXIT_PLAN_MODE: EXIT_PLAN_MODE_TOOL,
  ASK_USER: ASK_USER_TOOL,
  TODO_WRITE: TODO_WRITE_TOOL,
  TODO_READ: TODO_READ_TOOL,
  MEMORY_LIST: MEMORY_LIST_TOOL,
  MEMORY_READ: MEMORY_READ_TOOL,
  MEMORY_WRITE: MEMORY_WRITE_TOOL,
  MEMORY_DELETE: MEMORY_DELETE_TOOL,
  APPLY_PATCH: APPLY_PATCH_TOOL,
  SHELL: SHELL_TOOL,
  SHELL_START: SHELL_START_TOOL,
  SHELL_PTY_START: SHELL_PTY_START_TOOL,
  SHELL_STATUS: SHELL_STATUS_TOOL,
  SHELL_SEND: SHELL_SEND_TOOL,
  SHELL_RESIZE: SHELL_RESIZE_TOOL,
  SHELL_STOP: SHELL_STOP_TOOL,
  MCP_SERVER: MCP_SERVER_TOOL,
} as const

export const TOOL_PREFIXES = { MCP: MCP_TOOL_PREFIX, HOOK: HOOK_TOOL_PREFIX } as const
