import type { DoCodeLanguage } from "../config.js"
import { builtinCommandCompletions } from "./completion.js"
import { t } from "./i18n.js"
import { AUTH_COMMAND, BUG_COMMAND, CLEAR_COMMAND, COMPACT_COMMAND, DIFF_COMMAND, EFFORT_COMMAND, EXIT_COMMAND, EXPORT_COMMAND, EXTENSIONS_COMMAND, HELP_COMMAND, LANGUAGE_COMMAND, MEMORY_COMMAND, MODEL_COMMAND, PERMISSIONS_COMMAND, PLAN_COMMAND, RENAME_COMMAND, RESUME_COMMAND, REWIND_COMMAND, STATS_COMMAND, STATUS_COMMAND, THINKING_COMMAND } from "./shortcut-command-policy.js"

type HelpEntry = { usage: string; command?: string; description?: string }
type HelpGroup = { title: string; entries: HelpEntry[] }

const HELP_GROUPS: HelpGroup[] = [
  {
    title: "Common commands",
    entries: [
      { usage: HELP_COMMAND, command: HELP_COMMAND },
      { usage: STATUS_COMMAND, command: STATUS_COMMAND },
      { usage: STATS_COMMAND, command: STATS_COMMAND },
      { usage: COMPACT_COMMAND, command: COMPACT_COMMAND },
      { usage: CLEAR_COMMAND, command: CLEAR_COMMAND },
      { usage: EXIT_COMMAND, command: EXIT_COMMAND },
    ],
  },
  {
    title: "Model and interface",
    entries: [
      { usage: `${MODEL_COMMAND} [provider/model]`, command: MODEL_COMMAND },
      { usage: `${MODEL_COMMAND} set <model> --persist`, description: "Set the default model for future sessions" },
      { usage: AUTH_COMMAND, command: AUTH_COMMAND },
      { usage: `${EFFORT_COMMAND} [level] [--persist]`, command: EFFORT_COMMAND },
      { usage: `${THINKING_COMMAND} [mode] [--persist]`, command: THINKING_COMMAND },
      { usage: `${LANGUAGE_COMMAND} [language]`, command: LANGUAGE_COMMAND },
      { usage: EXTENSIONS_COMMAND, command: EXTENSIONS_COMMAND },
    ],
  },
  {
    title: "Planning and permissions",
    entries: [
      { usage: `${PLAN_COMMAND} [goal|exit]`, command: PLAN_COMMAND },
      { usage: PERMISSIONS_COMMAND, command: PERMISSIONS_COMMAND },
    ],
  },
  {
    title: "Sessions and workspace",
    entries: [
      { usage: `${RESUME_COMMAND} [name]`, command: RESUME_COMMAND },
      { usage: `${RENAME_COMMAND} <name>`, command: RENAME_COMMAND },
      { usage: `${EXPORT_COMMAND} [md|json] [path]`, command: EXPORT_COMMAND },
      { usage: DIFF_COMMAND, command: DIFF_COMMAND },
      { usage: `${REWIND_COMMAND} [both|chat|files]`, command: REWIND_COMMAND },
      { usage: `${MEMORY_COMMAND} [list|show|reload]`, command: MEMORY_COMMAND },
      { usage: `${BUG_COMMAND} [description]`, command: BUG_COMMAND },
    ],
  },
  {
    title: "Input shortcuts",
    entries: [
      { usage: "@path", description: "Add workspace file context" },
      { usage: "!command", description: "Run a Shell command directly" },
      { usage: "Ctrl+R", description: "Cycle reasoning effort" },
      { usage: "Ctrl+T", description: "View all messages" },
      { usage: "Ctrl+V", description: "Paste clipboard image" },
      { usage: "Tab", description: "Accept completion" },
      { usage: "Shift+Tab", description: "Toggle Plan mode" },
      { usage: "Ctrl+Enter", description: "Insert newline" },
    ],
  },
]

export function helpText(language: DoCodeLanguage) {
  const descriptions = new Map(builtinCommandCompletions(language).map((item) => [item.label, item.description]))
  const width = Math.max(...HELP_GROUPS.flatMap((group) => group.entries.map((entry) => entry.usage.length)))
  return HELP_GROUPS.map((group) => [
    t(language, group.title),
    ...group.entries.map((entry) => `  ${entry.usage.padEnd(width)}  ${entry.command ? descriptions.get(entry.command) : t(language, entry.description ?? "")}`),
  ].join("\n")).join("\n\n")
}
