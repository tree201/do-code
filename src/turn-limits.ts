export const DEFAULT_MAX_TURNS = 100
export const IDENTICAL_TOOL_LOOP_THRESHOLD = 5

export class MaxSessionTurnsError extends Error {
  readonly maxTurns: number

  constructor(maxTurns: number) {
    super(`Reached max session turns for this task (${maxTurns}). Increase the limit with --max-steps or the active agent profile.`)
    this.name = "MaxSessionTurnsError"
    this.maxTurns = maxTurns
  }
}
