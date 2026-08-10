export function emptyReplyInstruction(reason: string, thoughtOnly: boolean) {
  return thoughtOnly
    ? "Your previous response contained reasoning but no actionable output. Continue now by calling the required tool, or provide the final user-facing answer. Do not return more reasoning without an action."
    : `Your previous response was empty (finish_reason: ${reason}). Continue the task by calling a tool or providing the final user-facing answer.`
}

export function emptyReplyFailure(reason: string, thoughtOnly: boolean) {
  if (reason === "length" || reason === "max_tokens") return `Model exhausted its output token limit without a final answer after 3 attempts (finish_reason: ${reason})`
  if (thoughtOnly) return `Model returned reasoning but no tool call or final answer after 3 attempts (finish_reason: ${reason})`
  return `Model returned neither tool calls nor a final answer after 3 attempts (finish_reason: ${reason})`
}
