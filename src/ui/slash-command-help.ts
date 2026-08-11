import type { DoCodeLanguage } from "../config.js"
import { t } from "./i18n.js"

const HELP_OVERVIEW = "/help Help · /status Status · /stats Statistics · /compact Compact · /diff Changes · /clear Clear · /exit Exit"
const HELP_MODELS = "/model [provider/model] Switch the current model · /model set <model> --persist Set the future-session default · /auth Configure model providers · /paste-image Attach clipboard image · /remove-image <index> Remove attachment · /thinking [auto|on|off] Switch thinking mode · /effort [low|medium|high|xhigh|max] Switch reasoning effort · /language [zh|en] Switch language · /extensions Show commands and skills"
const HELP_PLANNING = "/plan [goal|exit] Enter or leave planning · /permissions Choose permissions · /approval-mode [mode] Switch approval mode · /trust Trust workspace"
const HELP_BUG = "/bug [description] Capture a bad case and create an error ID"
const HELP_MEMORY = "/memory list|show|reload Manage layered AGENTS.md files"
const HELP_RESTORE = "/restore [id] Restore files · /rewind [both|chat|files] Rewind"
const HELP_SESSIONS = "/resume [name] Resume a session · /rename <name> Rename · /export [md|json] [path] Export"
const HELP_INPUT = "@path Add workspace file context · !command Run shell directly · Ctrl+R Cycle reasoning effort · Ctrl+T View all messages · Tab Accept completion · Shift+Tab Toggle Plan · Ctrl+Enter New line"

const HELP_LINES = [HELP_OVERVIEW, HELP_MODELS, HELP_PLANNING, HELP_BUG, HELP_MEMORY, HELP_RESTORE, HELP_SESSIONS, HELP_INPUT]

export function helpText(language: DoCodeLanguage) {
  return HELP_LINES.map((line) => t(language, line)).join("\n")
}
