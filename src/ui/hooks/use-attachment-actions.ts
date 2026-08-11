import { useCallback } from "react"
import { classifyPastedImagePaths, MAX_IMAGE_COUNT, MAX_IMAGE_TOTAL_BYTES } from "../../image-attachments.js"
import { acceptAttachments, attachmentInsertionIndex, insertAttachmentTokens, removeAttachmentToken } from "../attachment-model.js"
import { insertEditorText } from "../editor.js"
import { t } from "../i18n.js"
import type { ChatAppProps } from "../chat-app-types.js"
import type { ChatAppState } from "./use-chat-app-state.js"

export function useAttachmentActions(props: ChatAppProps, state: ChatAppState) {
  const insertAttachedImages = useCallback((images: typeof state.attachedImages) => {
    if (!images.length) return
    const snapshot = state.composerOwner.getSnapshot()
    const index = attachmentInsertionIndex(snapshot.editor)
    state.updateAttachedImages((current) => [...current.slice(0, index), ...images, ...current.slice(index)])
    state.setEditor((current) => insertAttachmentTokens(current, images.length))
  }, [state.composerOwner, state.setEditor, state.updateAttachedImages])

  const removeAttachedImage = useCallback((index: number) => {
    state.setEditor((current) => removeAttachmentToken(current, index))
    state.updateAttachedImages((current) => current.filter((_, currentIndex) => currentIndex !== index))
  }, [state.setEditor, state.updateAttachedImages])

  const attachClipboardImage = useCallback(async () => {
    if (!props.pasteImage) throw new Error("Clipboard image support is unavailable")
    if (state.composerOwner.getSnapshot().attachments.length >= MAX_IMAGE_COUNT) {
      state.append({ kind: "error", text: t(state.activeLanguage, "A prompt can include at most {count} images.", { count: MAX_IMAGE_COUNT }) })
      throw new Error("Image limit reached")
    }
    const image = await props.pasteImage()
    const { accepted } = acceptAttachments(state.composerOwner.getSnapshot().attachments, [image], MAX_IMAGE_TOTAL_BYTES)
    if (!accepted.length) {
      state.append({ kind: "error", text: t(state.activeLanguage, "Attached images exceed the 20 MB total limit.") })
      return false
    }
    state.composerOwner.markPaste()
    insertAttachedImages(accepted)
    return true
  }, [insertAttachedImages, props.pasteImage, state.append, state.composerOwner])

  const attachPastedImagePaths = useCallback((pasted: string) => {
    const classified = classifyPastedImagePaths(pasted)
    if (!classified.allImages || !props.pasteImagePaths) return false
    const available = MAX_IMAGE_COUNT - state.composerOwner.getSnapshot().attachments.length
    if (available <= 0) {
      state.append({ kind: "error", text: t(state.activeLanguage, "A prompt can include at most {count} images.", { count: MAX_IMAGE_COUNT }) })
      return true
    }
    void props.pasteImagePaths(classified.imagePaths.slice(0, available)).then((images) => {
      if (!images.length) { state.setEditor((current) => insertEditorText(current, pasted)); return }
      const { accepted, skipped } = acceptAttachments(state.composerOwner.getSnapshot().attachments, images, MAX_IMAGE_TOTAL_BYTES)
      if (!accepted.length) { state.append({ kind: "error", text: t(state.activeLanguage, "Attached images exceed the 20 MB total limit.") }); return }
      if (skipped) state.append({ kind: "error", text: t(state.activeLanguage, "Some images were skipped because attachments exceed the 20 MB total limit.") })
      insertAttachedImages(accepted)
    }).catch(() => state.setEditor((current) => insertEditorText(current, pasted)))
    return true
  }, [insertAttachedImages, props.pasteImagePaths, state.append, state.composerOwner, state.setEditor])

  return { removeAttachedImage, attachClipboardImage, attachPastedImagePaths }
}

export type AttachmentActions = ReturnType<typeof useAttachmentActions>
