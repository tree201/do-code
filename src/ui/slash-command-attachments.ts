import type { SlashCommandContext } from "./slash-command-context.js"
import { MAX_IMAGE_COUNT } from "../image-attachments.js"

export function executeAttachmentSlashCommand(input: string, context: SlashCommandContext) {
  const { props, state, attachments } = context
  if (input === "/paste-image") {
    if (!props.pasteImage) state.append({ kind: "error", text: "Cannot read an image from the system clipboard. Use @path/to/image instead." })
    else if (state.attachedImages.length >= MAX_IMAGE_COUNT) state.append({ kind: "error", text: `A prompt can include at most ${MAX_IMAGE_COUNT} images.` })
    else void attachments.attachClipboardImage().catch(() => state.append({ kind: "error", text: "Cannot read an image from the system clipboard. Use @path/to/image instead." }))
    return true
  }
  if (input === "/remove-image" || input.startsWith("/remove-image ")) {
    attachments.removeAttachedImage(input.slice("/remove-image".length))
    return true
  }
  return false
}
