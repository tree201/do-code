import { readFile, stat } from "node:fs/promises"
import { resolveInside } from "./tools.js"
import type { UserContent } from "./protocol.js"

const MAX_REFERENCED_FILE_BYTES = 100_000
const MAX_REFERENCED_TOTAL_BYTES = 300_000
const MAX_IMAGE_BYTES = 10_000_000
const MAX_IMAGE_TOTAL_BYTES = 20_000_000
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" }

export async function expandPromptContent(prompt: string, workspace: string): Promise<UserContent> {
  const references = [...prompt.matchAll(/(?:^|\s)@([^\s@]+)/g)].map((match) => match[1]!).filter(Boolean)
  const unique = [...new Set(references)]
  if (!unique.length) return prompt
  const textSections: string[] = []
  const images: Array<{ type: "image_url"; image_url: { url: string; detail: "auto" } }> = []
  let textTotal = 0, imageTotal = 0
  for (const reference of unique) {
    const target = (() => { try { return resolveInside(workspace, reference) } catch { return null } })()
    if (!target) continue
    const info = await stat(target).catch(() => null)
    if (!info?.isFile()) continue
    const mime = IMAGE_TYPES[pathExtension(reference)]
    if (mime) {
      if (info.size > MAX_IMAGE_BYTES || imageTotal + info.size > MAX_IMAGE_TOTAL_BYTES || images.length >= 4) continue
      const data = await readFile(target)
      imageTotal += data.byteLength
      images.push({ type: "image_url", image_url: { url: `data:${mime};base64,${data.toString("base64")}`, detail: "auto" } })
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

function pathExtension(value: string) {
  const normalized = value.toLowerCase()
  return Object.keys(IMAGE_TYPES).find((extension) => normalized.endsWith(extension)) ?? ""
}

export async function expandFileReferences(prompt: string, workspace: string) {
  const content = await expandPromptContent(prompt, workspace)
  return typeof content === "string" ? content : content.find((part) => part.type === "text")?.text ?? prompt
}
