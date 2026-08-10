import { useCallback } from "react"
import { classifyPastedImagePaths, MAX_IMAGE_COUNT, MAX_IMAGE_TOTAL_BYTES } from "../../image-attachments.js"
import { acceptAttachments, attachmentIndex } from "../attachment-model.js"
import { insertEditorText } from "../editor.js"
import type { ChatAppProps } from "../chat-app-types.js"
import type { ChatAppState } from "./use-chat-app-state.js"

export function useAttachmentActions(props: ChatAppProps, state: ChatAppState) {
  const removeAttachedImage = useCallback((query: string) => {
    const index = attachmentIndex(state.attachedImages, query)
    const image = state.attachedImages[index]
    if (!image) {
      state.append({ kind: "error", text: "Usage: /remove-image <index|name>" })
      return
    }
    state.updateAttachedImages((current) => current.filter((_, currentIndex) => currentIndex !== index))
  }, [state.append, state.attachedImages, state.updateAttachedImages])

  const attachClipboardImage = useCallback(async () => {
    if (!props.pasteImage) throw new Error("Clipboard image support is unavailable")
    if (state.composerOwner.getSnapshot().attachments.length >= MAX_IMAGE_COUNT) {
      state.append({ kind: "error", text: `A prompt can include at most ${MAX_IMAGE_COUNT} images.` })
      throw new Error("Image limit reached")
    }
    const image = await props.pasteImage()
    const { accepted } = acceptAttachments(state.composerOwner.getSnapshot().attachments, [image], MAX_IMAGE_TOTAL_BYTES)
    if (!accepted.length) {
      state.append({ kind: "error", text: "Attached images exceed the 20 MB total limit." })
      return false
    }
    state.composerOwner.markPaste()
    state.updateAttachedImages((current) => [...current, image])
    return true
  }, [props.pasteImage, state.append, state.composerOwner, state.updateAttachedImages])

  const attachPastedImagePaths = useCallback((pasted: string) => {
    const classified = classifyPastedImagePaths(pasted)
    if (!classified.allImages || !props.pasteImagePaths) return false
    const available = MAX_IMAGE_COUNT - state.composerOwner.getSnapshot().attachments.length
    if (available <= 0) {
      state.append({ kind: "error", text: `A prompt can include at most ${MAX_IMAGE_COUNT} images.` })
      return true
    }
    void props.pasteImagePaths(classified.imagePaths.slice(0, available)).then((images) => {
      if (!images.length) { state.setEditor((current) => insertEditorText(current, pasted)); return }
      const { accepted, skipped } = acceptAttachments(state.composerOwner.getSnapshot().attachments, images, MAX_IMAGE_TOTAL_BYTES)
      if (!accepted.length) { state.append({ kind: "error", text: "Attached images exceed the 20 MB total limit." }); return }
      if (skipped) state.append({ kind: "error", text: "Some images were skipped because attachments exceed the 20 MB total limit." })
      state.updateAttachedImages((current) => [...current, ...accepted])
    }).catch(() => state.setEditor((current) => insertEditorText(current, pasted)))
    return true
  }, [props.pasteImagePaths, state.append, state.composerOwner, state.setEditor, state.updateAttachedImages])

  return { removeAttachedImage, attachClipboardImage, attachPastedImagePaths }
}

export type AttachmentActions = ReturnType<typeof useAttachmentActions>
