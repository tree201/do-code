export const HELP_COMMAND = "/help"
export const STATUS_COMMAND = "/status"
export const STATS_COMMAND = "/stats"
export const PERMISSIONS_COMMAND = "/permissions"
export const EXTENSIONS_COMMAND = "/extensions"
export const LANGUAGE_COMMAND = "/language"
export const EXIT_COMMAND = "/exit"
export const MODEL_COMMAND = "/model"
export const EFFORT_COMMAND = "/effort"
export const THINKING_COMMAND = "/thinking"
export const PLAN_COMMAND = "/plan"
export const RESUME_COMMAND = "/resume"
export const EXPORT_COMMAND = "/export"
export const MEMORY_COMMAND = "/memory"
export const REWIND_COMMAND = "/rewind"
export const AUTH_COMMAND = "/auth"
export const BUG_COMMAND = "/bug"
export const COMPACT_COMMAND = "/compact"
export const DIFF_COMMAND = "/diff"
export const CLEAR_COMMAND = "/clear"
export const RENAME_COMMAND = "/rename"

export function commandWithArgument(input: string, command: string) {
  return input === command || input.startsWith(`${command} `)
}

export function commandArgument(input: string, command: string) {
  return input.slice(command.length).trim()
}

const CONCURRENT_SLASH_COMMANDS = new Set([
  HELP_COMMAND,
  STATUS_COMMAND,
  STATS_COMMAND,
  PERMISSIONS_COMMAND,
  EXTENSIONS_COMMAND,
  LANGUAGE_COMMAND,
  EXIT_COMMAND,
])

export function canRunSlashCommandDuringTask(input: string) {
  const normalized = input.trim()
  const command = normalized.split(/\s+/, 1)[0] ?? ""
  return CONCURRENT_SLASH_COMMANDS.has(command) || normalized === MODEL_COMMAND
}

export function isReasoningEffortShortcut(input: string, key: { ctrl?: boolean }) {
  return key.ctrl === true && input.toLowerCase() === "r"
}

export function isApprovalModeShortcut(input: string, key: { ctrl?: boolean }) {
  return key.ctrl === true && input.toLowerCase() === "p"
}

export function isHelpShortcut(input: string, key: { backspace?: boolean; ctrl?: boolean }) {
  return key.backspace === true && input === "" || key.ctrl === true && input.toLowerCase() === "h"
}
