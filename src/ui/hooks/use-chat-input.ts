import { useInput } from "ink"
import { routeDialogInput } from "../input-dialog-router.js"
import { routeEditorInput } from "../input-editor-router.js"
import type { ChatInputKey } from "../input-routing-types.js"
import type { ChatAppProps } from "../chat-app-types.js"
import type { AttachmentActions } from "./use-attachment-actions.js"
import type { ChatAppState } from "./use-chat-app-state.js"
import type { SessionActions } from "./use-session-actions.js"
import type { TranscriptController } from "./use-transcript-controller.js"

export function useChatInput(props: ChatAppProps, state: ChatAppState, transcript: TranscriptController, attachments: AttachmentActions, sessions: SessionActions, submit: (input: string) => void, exit: () => void) {
  useInput((rawInput, inkKey) => {
    const key = { ...inkKey } as ChatInputKey
    if (/^\[(?:13;5u|27;5;13~)$/.test(rawInput)) {
      key.ctrl = true
      key.return = true
    }
    const input = rawInput.replaceAll("\u001b[200~", "").replaceAll("\u001b[201~", "")
    if (routeDialogInput(rawInput, input, key, props, state, transcript, sessions)) return
    routeEditorInput(rawInput, input, key, props, state, transcript, attachments, submit, exit)
  }, { isActive: state.activeDialog.kind !== "auth" && state.activeDialog.kind !== "model" })
}
