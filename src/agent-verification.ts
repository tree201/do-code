import { isMutationTool, verificationCommand } from "./completion-verification.js"

const SHELL_TOOL = "shell"

export type VerificationState = {
  unverifiedMutation: boolean
  verificationNudges: number
}

export function updateVerificationState(state: VerificationState, toolName: string, args: unknown, ok: boolean) {
  if (ok && isMutationTool(toolName)) return { ...state, unverifiedMutation: true }
  const command = toolName === SHELL_TOOL ? verificationCommand(args) : null
  return command && ok ? { ...state, unverifiedMutation: false } : state
}

export function shouldRequestVerification(state: VerificationState, requireVerification: boolean) {
  return requireVerification && state.unverifiedMutation && state.verificationNudges < 1
}

export function recordVerificationNudge(state: VerificationState) {
  return { ...state, verificationNudges: state.verificationNudges + 1 }
}
