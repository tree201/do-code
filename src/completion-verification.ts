export type VerificationCommand = {
  command: string
  ok: boolean
  output: string
}

export type CompletionVerification = {
  status: "passed" | "failed" | "not_run" | "not_required"
  commands: VerificationCommand[]
  summary: string
}

const MUTATION_TOOLS = new Set(["write_file", "edit_file", "apply_patch"])
const VERIFICATION_COMMAND = /(?:^|(?:&&|;|\|\|)\s*)(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+(?:test|build|lint|typecheck|check))\b|(?:^|\s)(?:node\s+--test|deno\s+test|python(?:3)?\s+-m\s+pytest|pytest|go\s+test|cargo\s+(?:test|check)|mvn\s+test|gradle\s+test|tsc\b|eslint\b|biome\s+check|ruff\s+check)/i

export function isMutationTool(name: string) {
  return MUTATION_TOOLS.has(name)
}

export function verificationCommand(args: unknown) {
  if (!args || typeof args !== "object") return null
  const command = (args as Record<string, unknown>).command
  return typeof command === "string" && VERIFICATION_COMMAND.test(command) ? command : null
}

export function completionVerification(changed: boolean, commands: VerificationCommand[]): CompletionVerification {
  if (!changed) return { status: "not_required", commands, summary: "No workspace changes required verification." }
  if (!commands.length) return { status: "not_run", commands, summary: "Workspace changed, but no test, build, lint, typecheck, or equivalent verification command was observed." }
  const failed = commands.filter((item) => !item.ok)
  if (failed.length) return { status: "failed", commands, summary: `${failed.length} of ${commands.length} verification commands failed.` }
  return { status: "passed", commands, summary: `${commands.length} verification command${commands.length === 1 ? "" : "s"} passed.` }
}
