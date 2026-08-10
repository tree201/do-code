import { graphemes, replaceEditorRange, type EditorState } from "./editor.js"

export const IMAGE_ATTACHMENT_TOKEN = "\uFFFC"

export type ImageAttachment = { reference: string; name: string; size?: number }

export function attachmentIndex(attachments: ImageAttachment[], query: string) {
  const normalized = query.trim()
  return /^\d+$/.test(normalized)
    ? Number(normalized) - 1
    : attachments.findIndex((image) => image.name === normalized || image.reference === normalized)
}

export function attachmentInsertionIndex(editor: EditorState) {
  return graphemes(editor.value).slice(0, editor.cursor).filter((part) => part === IMAGE_ATTACHMENT_TOKEN).length
}

export function attachmentTokenIndex(editor: EditorState, direction: "backspace" | "delete") {
  const parts = graphemes(editor.value)
  const position = direction === "backspace" ? editor.cursor - 1 : editor.cursor
  if (position < 0 || parts[position] !== IMAGE_ATTACHMENT_TOKEN) return -1
  return parts.slice(0, position).filter((part) => part === IMAGE_ATTACHMENT_TOKEN).length
}

export function insertAttachmentTokens(editor: EditorState, count = 1) {
  const next = replaceEditorRange(editor, editor.cursor, editor.cursor, IMAGE_ATTACHMENT_TOKEN.repeat(count))
  return { ...next, undoStack: [], redoStack: [] }
}

export function removeAttachmentToken(editor: EditorState, index: number) {
  const parts = graphemes(editor.value)
  let current = 0
  for (let position = 0; position < parts.length; position++) {
    if (parts[position] !== IMAGE_ATTACHMENT_TOKEN) continue
    if (current === index) {
      const next = replaceEditorRange(editor, position, position + 1, "")
      return { ...next, undoStack: [], redoStack: [] }
    }
    current++
  }
  return editor
}

export function stripAttachmentTokens(value: string) {
  return value.replaceAll(IMAGE_ATTACHMENT_TOKEN, "")
}

export function attachmentBytes(attachments: ImageAttachment[]) {
  return attachments.reduce((total, image) => total + (image.size ?? 0), 0)
}

export function acceptAttachments(current: ImageAttachment[], incoming: ImageAttachment[], maximumBytes: number) {
  let totalBytes = attachmentBytes(current)
  const accepted: ImageAttachment[] = []
  for (const image of incoming) {
    const nextTotal = totalBytes + (image.size ?? 0)
    if (nextTotal > maximumBytes) continue
    totalBytes = nextTotal
    accepted.push(image)
  }
  return { accepted, skipped: incoming.length - accepted.length, totalBytes }
}
