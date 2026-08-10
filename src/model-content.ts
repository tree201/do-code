import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import type { Message, UserContentPart } from "./protocol.js"

const MAX_IMAGE_CACHE_BYTES = 40_000_000
type CachedImage = { signature: string; value: { data: string; mimeType: Extract<UserContentPart, { type: "image" }>["mimeType"] }; bytes: number }
const imageCache = new Map<string, CachedImage>()
let imageCacheBytes = 0

function cacheImage(file: string, entry: CachedImage) {
  const previous = imageCache.get(file)
  if (previous) imageCacheBytes -= previous.bytes
  imageCache.delete(file)
  imageCache.set(file, entry)
  imageCacheBytes += entry.bytes
  while (imageCacheBytes > MAX_IMAGE_CACHE_BYTES && imageCache.size > 1) {
    const oldest = imageCache.entries().next().value as [string, CachedImage] | undefined
    if (!oldest) break
    imageCache.delete(oldest[0])
    imageCacheBytes -= oldest[1].bytes
  }
}

export async function imageData(part: Extract<UserContentPart, { type: "image" }>, sessionDirectory?: string) {
  const file = path.isAbsolute(part.path) ? part.path : resolveSessionAttachment(part.path, sessionDirectory)
  const info = await stat(file)
  const signature = `${info.size}:${info.mtimeMs}`
  const cached = imageCache.get(file)
  if (cached?.signature === signature && cached.value.mimeType === part.mimeType) {
    imageCache.delete(file); imageCache.set(file, cached)
    return cached.value
  }
  const value = { data: (await readFile(file)).toString("base64"), mimeType: part.mimeType }
  cacheImage(file, { signature, value, bytes: value.data.length })
  return value
}

function resolveSessionAttachment(reference: string, sessionDirectory?: string) {
  if (!sessionDirectory) throw new Error(`Cannot resolve session attachment without a session directory: ${reference}`)
  const file = path.resolve(sessionDirectory, reference)
  const relative = path.relative(sessionDirectory, file)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Invalid session attachment path: ${reference}`)
  return file
}

export async function openAIContent(content: Message["content"], sessionDirectory?: string) {
  if (typeof content === "string") return content
  if (!content) return ""
  return await Promise.all(content.map(async (part) => {
    if (part.type === "text") return part
    if (part.type === "image_url") return part
    const image = await imageData(part, sessionDirectory)
    return { type: "image_url" as const, image_url: { url: `data:${image.mimeType};base64,${image.data}`, detail: "auto" as const } }
  }))
}

export async function anthropicContent(content: Message["content"], sessionDirectory?: string) {
  if (typeof content === "string") return content
  if (!content) return ""
  return await Promise.all(content.map(async (part) => {
    if (part.type === "text") return part
    if (part.type === "image_url") {
      const image = inlineImageUrl(part.image_url.url)
      return { type: "image" as const, source: { type: "base64" as const, media_type: image.mimeType, data: image.data } }
    }
    const image = await imageData(part, sessionDirectory)
    return { type: "image" as const, source: { type: "base64" as const, media_type: image.mimeType, data: image.data } }
  }))
}

export function inlineImageUrl(url: string) {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url)
  if (!match) throw new Error("Provider-native image conversion requires a PNG, JPEG, GIF, or WebP base64 data URL")
  return { mimeType: match[1], data: match[2] }
}

export function hasImageInput(messages: Message[]) {
  return messages.some((message) => message.role === "user" && Array.isArray(message.content) && message.content.some((part) => part.type === "image" || part.type === "image_url"))
}

export function requireImageSupport(messages: Message[], supported: boolean | undefined, model: string) {
  if (hasImageInput(messages) && supported === false) throw new Error(`Model does not support image input: ${model}`)
}
