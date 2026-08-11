import type { SlashCommandContext } from "./slash-command-context.js"
import { MAX_IMAGE_COUNT } from "../image-attachments.js"
import { t } from "./i18n.js"

export function executeAttachmentSlashCommand(input: string, context: SlashCommandContext) {
  const { props, state, attachments } = context
  if (input === "/paste-image") {
    if (!props.pasteImage) state.append({ kind: "error", text: t(state.activeLanguage, "Cannot read an image from the system clipboard. Use @path/to/image instead.") })
    else if (state.attachedImages.length >= MAX_IMAGE_COUNT) state.append({ kind: "error", text: t(state.activeLanguage, "A prompt can include at most {count} images.", { count: MAX_IMAGE_COUNT }) })
    else void attachments.attachClipboardImage().catch(() => state.append({ kind: "error", text: t(state.activeLanguage, "Cannot read an image from the system clipboard. Use @path/to/image instead.") }))
    return true
  }
  if (input === "/remove-image" || input.startsWith("/remove-image ")) {
    attachments.removeAttachedImage(input.slice("/remove-image".length))
    return true
  }
  return false
}
