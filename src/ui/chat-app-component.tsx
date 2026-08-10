import React from "react"
import { useApp, useStdout } from "ink"
import { useAttachmentActions } from "./hooks/use-attachment-actions.js"
import { useChatAppState } from "./hooks/use-chat-app-state.js"
import { useChatEffects } from "./hooks/use-chat-effects.js"
import { useChatInput } from "./hooks/use-chat-input.js"
import { useSessionActions } from "./hooks/use-session-actions.js"
import { useTranscriptController } from "./hooks/use-transcript-controller.js"
import { useTurnSubmission } from "./hooks/use-turn-submission.js"
import { ChatAppView } from "./components/chat-app-view.js"
import type { ChatAppProps } from "./chat-app-types.js"

export function ChatApp(props: ChatAppProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const state = useChatAppState(props, stdout.columns || 80, stdout.rows || 24)
  const transcript = useTranscriptController(props, state)
  const attachments = useAttachmentActions(props, state)
  const sessions = useSessionActions(props, state, transcript)
  const submit = useTurnSubmission(props, state, transcript, attachments, sessions, exit)
  useChatEffects(props, state, stdout)
  useChatInput(props, state, transcript, attachments, sessions, submit, exit)
  return <ChatAppView props={props} state={state} />
}
