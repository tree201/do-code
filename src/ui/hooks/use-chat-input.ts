import { useInput } from "ink"
import { normalizeEnhancedKeyboardKey } from "../enhanced-keyboard-key.js"
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
    const normalized = normalizeEnhancedKeyboardKey(rawInput, inkKey as ChatInputKey)
    const key = normalized.key
    const input = normalized.input.replaceAll("\u001b[200~", "").replaceAll("\u001b[201~", "")
    const dialog = state.getActiveDialog()
    if (dialog.kind === "auth" || dialog.kind === "model" || dialog.kind === "effort") {
      state.dialogInputHandlers.current[dialog.kind]?.(input, key)
      return
    }
    if (routeDialogInput(rawInput, input, key, props, state, transcript, sessions)) return
    routeEditorInput(rawInput, input, key, props, state, transcript, attachments, submit, exit)
  })
}
