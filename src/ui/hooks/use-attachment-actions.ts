import { useCallback } from "react"
import { classifyPastedImagePaths, MAX_IMAGE_COUNT, MAX_IMAGE_TOTAL_BYTES } from "../../image-attachments.js"
import { acceptAttachments, attachmentInsertionIndex, imageNodes, insertAttachmentTokens, pastedTextNode, removeAttachmentToken, shouldFoldPastedText, type ComposerInlineNode } from "../attachment-model.js"
import { insertEditorText } from "../editor.js"
import { t } from "../i18n.js"
import type { ChatAppProps } from "../chat-app-types.js"
import type { ChatAppState } from "./use-chat-app-state.js"

export function useAttachmentActions(props: ChatAppProps, state: ChatAppState) {
  const insertNodes = useCallback((nodes: ComposerInlineNode[]) => {
    if (!nodes.length) return
    const snapshot = state.composerOwner.getSnapshot()
    const index = attachmentInsertionIndex(snapshot.editor)
    state.updateInlineNodes((current) => [...current.slice(0, index), ...nodes, ...current.slice(index)])
    state.setEditor((current) => insertAttachmentTokens(current, nodes.length))
  }, [state.composerOwner, state.setEditor, state.updateInlineNodes])

  const insertAttachedImages = useCallback((images: ReturnType<typeof imageNodes>) => {
    insertNodes(images.map((image) => ({ kind: "image", ...image })))
  }, [insertNodes])

  const insertPastedText = useCallback((text: string) => {
    if (shouldFoldPastedText(text)) insertNodes([pastedTextNode(text)])
    else state.setEditor((current) => insertEditorText(current, text))
  }, [insertNodes, state.setEditor])

  const removeInlineNode = useCallback((index: number) => {
    state.setEditor((current) => removeAttachmentToken(current, index))
    state.updateInlineNodes((current) => current.filter((_, currentIndex) => currentIndex !== index))
  }, [state.setEditor, state.updateInlineNodes])

  const attachClipboardImage = useCallback(async () => {
    if (!props.pasteImage) throw new Error("Clipboard image support is unavailable")
    const images = imageNodes(state.composerOwner.getSnapshot().nodes)
    if (images.length >= MAX_IMAGE_COUNT) {
      state.append({ kind: "error", text: t(state.activeLanguage, "A prompt can include at most {count} images.", { count: MAX_IMAGE_COUNT }) })
      throw new Error("Image limit reached")
    }
    const image = await props.pasteImage()
    const { accepted } = acceptAttachments(images, [image], MAX_IMAGE_TOTAL_BYTES)
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
    const existing = imageNodes(state.composerOwner.getSnapshot().nodes)
    const available = MAX_IMAGE_COUNT - existing.length
    if (available <= 0) {
      state.append({ kind: "error", text: t(state.activeLanguage, "A prompt can include at most {count} images.", { count: MAX_IMAGE_COUNT }) })
      return true
    }
    void props.pasteImagePaths(classified.imagePaths.slice(0, available)).then((images) => {
      if (!images.length) { insertPastedText(pasted); return }
      const { accepted, skipped } = acceptAttachments(existing, images, MAX_IMAGE_TOTAL_BYTES)
      if (!accepted.length) { state.append({ kind: "error", text: t(state.activeLanguage, "Attached images exceed the 20 MB total limit.") }); return }
      if (skipped) state.append({ kind: "error", text: t(state.activeLanguage, "Some images were skipped because attachments exceed the 20 MB total limit.") })
      insertAttachedImages(accepted)
    }).catch(() => insertPastedText(pasted))
    return true
  }, [insertAttachedImages, insertPastedText, props.pasteImagePaths, state.append, state.composerOwner])

  return { removeInlineNode, attachClipboardImage, attachPastedImagePaths, insertPastedText }
}

export type AttachmentActions = ReturnType<typeof useAttachmentActions>
