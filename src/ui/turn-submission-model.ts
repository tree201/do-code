import { canRunSlashCommandDuringTask } from "./shortcut-command-policy.js"

export type TurnSubmissionDisposition = "ignore" | "queue" | "execute"

export function turnSubmissionDisposition(input: string, imageCount: number, running: boolean): TurnSubmissionDisposition {
  const normalized = input.trim()
  if (!normalized && imageCount === 0) return "ignore"
  if (running && !canRunSlashCommandDuringTask(normalized)) return "queue"
  return "execute"
}
