import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { importImageAttachment, MAX_IMAGE_COUNT, MAX_IMAGE_TOTAL_BYTES, validateImageFile } from "./image-attachments.js"
import type { UserContent } from "./protocol.js"
import { resolveInside } from "./workspace-paths.js"

const MAX_REFERENCED_FILE_BYTES = 100_000
const MAX_REFERENCED_TOTAL_BYTES = 300_000
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"])
const PROMPT_REFERENCE = /(?:^|\s)@(?:(attachments\/[^\s@]*?\.(?:png|jpe?g|gif|webp))|([^\s@]+))/gi

export async function expandPromptContent(prompt: string, workspace: string, attachmentDirectory?: string): Promise<UserContent> {
  const references = [...prompt.matchAll(PROMPT_REFERENCE)].map((match) => match[1] ?? match[2]!).filter(Boolean)
  const unique = [...new Set(references)]
  if (!unique.length) return prompt
  const textSections: string[] = []
  const images: Array<{ type: "image"; mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; path: string; name: string }> = []
  let textTotal = 0
  let imageTotal = 0
  for (const reference of unique) {
    const sessionAttachment = attachmentDirectory ? sessionAttachmentReference(reference, attachmentDirectory) : null
    if (sessionAttachment) {
      if (images.length >= MAX_IMAGE_COUNT) throw new Error(`A prompt can contain at most ${MAX_IMAGE_COUNT} images`)
      const image = await validateImageFile(sessionAttachment.file)
      if (imageTotal + image.size > MAX_IMAGE_TOTAL_BYTES) throw new Error("Image attachments exceed the 20 MB total limit")
      imageTotal += image.size
      images.push({ type: "image", mimeType: image.mimeType, path: sessionAttachment.path, name: path.basename(sessionAttachment.path) })
      continue
    }
    const target = (() => { try { return resolveInside(workspace, reference) } catch { return null } })()
    if (!target) continue
    const info = await stat(target).catch(() => null)
    if (!info?.isFile()) continue
    if (IMAGE_EXTENSIONS.has(path.extname(reference).toLowerCase())) {
      if (images.length >= MAX_IMAGE_COUNT) throw new Error(`A prompt can contain at most ${MAX_IMAGE_COUNT} images`)
      if (!attachmentDirectory) throw new Error("Image attachments require a session attachment directory")
      const imported = await importImageAttachment(target, attachmentDirectory)
      if (imageTotal + imported.size > MAX_IMAGE_TOTAL_BYTES) throw new Error("Image attachments exceed the 20 MB total limit")
      imageTotal += imported.size
      images.push({ type: "image", mimeType: imported.mimeType, path: path.posix.join("attachments", imported.name), name: path.basename(reference) })
      continue
    }
    if (info.size > MAX_REFERENCED_FILE_BYTES || textTotal + info.size > MAX_REFERENCED_TOTAL_BYTES) continue
    const content = await readFile(target, "utf8").catch(() => null)
    if (content === null || content.includes("\0")) continue
    textTotal += Buffer.byteLength(content)
    textSections.push(`--- @${reference} ---\n${content}`)
  }
  const text = textSections.length ? `${prompt}\n\nReferenced file context:\n\n${textSections.join("\n\n")}` : prompt
  return images.length ? [{ type: "text", text }, ...images] : text
}

function sessionAttachmentReference(reference: string, attachmentDirectory: string) {
  const normalized = reference.replaceAll("\\", "/")
  if (!normalized.startsWith("attachments/")) return null
  const sessionDirectory = path.dirname(attachmentDirectory)
  const file = path.resolve(sessionDirectory, normalized)
  const relative = path.relative(sessionDirectory, file)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Invalid session attachment path: ${reference}`)
  return { file, path: normalized }
}

export async function expandFileReferences(prompt: string, workspace: string) {
  const content = await expandPromptContent(prompt, workspace)
  return typeof content === "string" ? content : content.find((part) => part.type === "text")?.text ?? prompt
}
