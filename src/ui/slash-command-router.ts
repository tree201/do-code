export type SlashCommandRoute =
  | { kind: "builtin"; command: string; argument: string }
  | { kind: "extension"; command: string; argument: string }
  | { kind: "unknown"; command: string; argument: string }
  | { kind: "none" }

const BUILTIN_COMMANDS = new Set([
  "help", "status", "stats", "compact", "diff", "clear", "exit", "model", "auth",
  "thinking", "effort", "language", "extensions", "plan", "permissions", "bug",
  "memory", "rewind", "resume", "rename", "export",
])

export function routeSlashCommand(input: string, extensionNames: string[] = []): SlashCommandRoute {
  const normalized = input.trim()
  if (!normalized.startsWith("/")) return { kind: "none" }
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(normalized)
  if (!match) return { kind: "none" }
  const command = match[1]!
  const argument = match[2]?.trim() ?? ""
  const extensions = new Set(extensionNames)
  if (BUILTIN_COMMANDS.has(command)) return { kind: "builtin", command, argument }
  return extensions.has(command)
    ? { kind: "extension", command, argument }
    : { kind: "unknown", command, argument }
}

export function slashCommandName(input: string) {
  const route = routeSlashCommand(input)
  return route.kind === "none" ? undefined : route.command
}
