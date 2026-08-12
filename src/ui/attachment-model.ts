import { graphemes, replaceEditorRange, type EditorState } from "./editor.js"

export const IMAGE_ATTACHMENT_TOKEN = "\uFFFC"

export type ImageAttachment = { reference: string; name: string; size?: number }
export type PastedTextAttachment = { kind: "pasted-text"; text: string; lineCount: number }
export type ComposerInlineNode = ({ kind: "image" } & ImageAttachment) | PastedTextAttachment
export type ComposerDraft = { value: string; nodes: ComposerInlineNode[] }

export function imageNodes(nodes: ComposerInlineNode[]): ImageAttachment[] {
  return nodes.flatMap((node) => node.kind === "image" ? [{ reference: node.reference, name: node.name, ...(node.size === undefined ? {} : { size: node.size }) }] : [])
}

export function pastedTextLineCount(text: string) {
  return text.split(/\r\n|\r|\n/).length
}

export function shouldFoldPastedText(text: string) {
  return pastedTextLineCount(text) >= 3 || text.length > 150
}

export function pastedTextNode(text: string): PastedTextAttachment {
  return { kind: "pasted-text", text, lineCount: pastedTextLineCount(text) }
}

export function pastedTextLabel(lineCount: number) {
  return `[Pasted ~${lineCount} lines]`
}

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

export function expandComposerValue(value: string, nodes: ComposerInlineNode[], mode: "model" | "display") {
  let nodeIndex = 0
  let imageIndex = 0
  return graphemes(value).map((part) => {
    if (part !== IMAGE_ATTACHMENT_TOKEN) return part
    const node = nodes[nodeIndex++]
    if (!node) return ""
    if (node.kind === "image") return mode === "model" ? `@${node.reference}` : `[Image #${++imageIndex}]`
    return mode === "model" ? node.text : pastedTextLabel(node.lineCount)
  }).join("")
}

export function composerDraftEqual(left: ComposerDraft, right: ComposerDraft) {
  if (left.value !== right.value || left.nodes.length !== right.nodes.length) return false
  return left.nodes.every((node, index) => {
    const other = right.nodes[index]
    if (!other || node.kind !== other.kind) return false
    if (node.kind === "pasted-text" && other.kind === "pasted-text") return node.text === other.text && node.lineCount === other.lineCount
    return node.kind === "image" && other.kind === "image"
      && node.reference === other.reference && node.name === other.name && node.size === other.size
  })
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
