import type { ChatAppProps } from "./chat-app-types.js"
import type { AttachmentActions } from "./hooks/use-attachment-actions.js"
import type { ChatAppState } from "./hooks/use-chat-app-state.js"
import type { SessionActions } from "./hooks/use-session-actions.js"
import type { TranscriptController } from "./hooks/use-transcript-controller.js"

export type SlashCommandContext = {
  props: ChatAppProps
  state: ChatAppState
  transcript: TranscriptController
  attachments: AttachmentActions
  sessions: SessionActions
  exit: () => void
}
