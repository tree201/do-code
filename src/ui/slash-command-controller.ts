import { executeGeneralSlashCommand } from "./slash-command-general.js"
import { executeSessionSlashCommand } from "./slash-command-session.js"
import type { SlashCommandContext } from "./slash-command-context.js"

export function executeSlashCommand(input: string, context: SlashCommandContext) {
  if (!input.startsWith("/")) return false
  return executeGeneralSlashCommand(input, context)
    || executeSessionSlashCommand(input, context)
}
