import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

export const MAX_IMAGE_COUNT = 4
export const MAX_IMAGE_BYTES = 10_000_000
export const MAX_IMAGE_TOTAL_BYTES = 20_000_000

export type ImageMimeType = "image/png" | "image/jpeg" | "image/gif" | "image/webp"

export type ValidatedImage = {
  data: Buffer
  mimeType: ImageMimeType
  extension: ".png" | ".jpg" | ".gif" | ".webp"
  size: number
}

const PASTED_IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i

export function classifyPastedImagePaths(pasted: string) {
  const tokens = pasted
    .split(/ (?=@?\/|@?[A-Za-z]:\\)/)
    .flatMap((part) => part.split("\n"))
    .map((token) => token.trim())
    .filter(Boolean)
  const imagePaths: string[] = []
  let allImages = tokens.length > 0
  for (const token of tokens) {
    const normalized = token
      .replace(/^@/, "")
      .replace(/^["']|["']$/g, "")
      .replace(/\\ /g, " ")
    if (PASTED_IMAGE_EXTENSION.test(normalized)) imagePaths.push(normalized)
    else allImages = false
  }
  return { imagePaths, allImages }
}

export async function validateImageFile(file: string): Promise<ValidatedImage> {
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) throw new Error(`Image file not found: ${file}`)
  if (info.size === 0) throw new Error(`Image file is empty: ${file}`)
  if (info.size > MAX_IMAGE_BYTES) throw new Error(`Image exceeds the 10 MB limit: ${file}`)
  const data = await readFile(file)
  const detected = detectImage(data)
  if (!detected) throw new Error(`Unsupported or damaged image. Expected PNG, JPEG, GIF, or WebP: ${file}`)
  const expected = extensionMime(path.extname(file))
  if (expected && expected !== detected.mimeType) throw new Error(`Image extension does not match its content: ${file} (${expected} vs ${detected.mimeType})`)
  return { data, size: data.byteLength, ...detected }
}

export async function importImageAttachment(source: string, attachmentDirectory: string) {
  const image = await validateImageFile(source)
  await mkdir(attachmentDirectory, { recursive: true })
  const name = `image_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}${image.extension}`
  const target = path.join(attachmentDirectory, name)
  await writeFile(target, image.data, { flag: "wx" })
  return { file: target, name, mimeType: image.mimeType, size: image.size }
}

export async function readClipboardImage(attachmentDirectory: string, platform = process.platform) {
  if (platform === "darwin") return await readDarwinClipboardImage(attachmentDirectory)
  const commands = clipboardCommands(platform)
  const errors: string[] = []
  for (const command of commands) {
    const result = await runClipboardCommand(command.command, command.args)
    if (!result.ok) {
      errors.push(`${command.command}: ${result.error}`)
      continue
    }
    if (!result.data.length) {
      errors.push(`${command.command}: clipboard did not contain image data`)
      continue
    }
    const temporary = path.join(attachmentDirectory, `.clipboard-${randomUUID()}`)
    await mkdir(attachmentDirectory, { recursive: true })
    await writeFile(temporary, result.data)
    try {
      return await importImageAttachment(temporary, attachmentDirectory)
    } finally {
      await import("node:fs/promises").then(({ rm }) => rm(temporary, { force: true }))
    }
  }
  throw new Error(`Cannot read an image from the system clipboard. Use @path/to/image instead.${errors.length ? ` Tried: ${errors.join("; ")}` : ""}`)
}

async function readDarwinClipboardImage(attachmentDirectory: string) {
  const temporary = path.join(attachmentDirectory, `.clipboard-${randomUUID()}.tiff`)
  let converted: string | undefined
  await mkdir(attachmentDirectory, { recursive: true })
  try {
    const result = await runClipboardCommand("osascript", ["-l", "JavaScript", "-e", "ObjC.import('AppKit'); const p=$.NSPasteboard.generalPasteboard; const t=p.dataForType('public.tiff') || p.dataForType('public.png'); if(t) $.NSFileHandle.fileHandleWithStandardOutput.writeData(t); else throw new Error('clipboard has no image')"])
    if (!result.ok || !result.data.length) throw new Error("Clipboard does not contain an image")
    await writeFile(temporary, result.data)
    converted = await convertClipboardImage(temporary, attachmentDirectory)
    return await importImageAttachment(converted, attachmentDirectory)
  } finally {
    await import("node:fs/promises").then(({ rm }) => Promise.all([
      rm(temporary, { force: true }),
      ...(converted ? [rm(converted, { force: true })] : []),
    ]))
  }
}

async function convertClipboardImage(source: string, attachmentDirectory: string) {
  const target = path.join(attachmentDirectory, `.clipboard-${randomUUID()}.png`)
  const result = await new Promise<{ ok: boolean; error: string }>((resolve) => {
    const child = spawn("sips", ["-s", "format", "png", source, "--out", target], { stdio: ["ignore", "ignore", "pipe"] })
    let error = ""
    child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString() })
    child.on("error", (cause) => resolve({ ok: false, error: cause.message }))
    child.on("close", (code) => resolve({ ok: code === 0, error }))
  })
  if (!result.ok) throw new Error(`Cannot convert clipboard image to PNG${result.error ? `: ${result.error.trim()}` : ""}`)
  return target
}

export async function readClipboardText(platform = process.platform) {
  const commands = clipboardTextCommands(platform)
  const errors: string[] = []
  for (const command of commands) {
    const result = await runClipboardCommand(command.command, command.args)
    if (result.ok) return result.data.toString("utf8").replace(/\r\n?/g, "\n")
    errors.push(`${command.command}: ${result.error}`)
  }
  throw new Error(`Cannot read text from the system clipboard.${errors.length ? ` Tried: ${errors.join("; ")}` : ""}`)
}

export function clipboardCommands(platform: NodeJS.Platform): Array<{ command: string; args: string[] }> {
  if (platform === "darwin") return [{ command: "osascript", args: ["-l", "JavaScript", "-e", "ObjC.import('AppKit'); const p=$.NSPasteboard.generalPasteboard; const d=p.dataForType('public.png') || p.dataForType('public.tiff'); if(d) $.NSFileHandle.fileHandleWithStandardOutput.writeData(d); else throw new Error('clipboard has no image')"] }]
  if (platform === "win32") return [{ command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-STA", "-Command", "$i=Get-Clipboard -Format Image -ErrorAction Stop;$m=New-Object IO.MemoryStream;$i.Save($m,[Drawing.Imaging.ImageFormat]::Png);[Console]::OpenStandardOutput().Write($m.ToArray(),0,$m.Length)"] }]
  return [
    { command: "wl-paste", args: ["--no-newline", "--type", "image/png"] },
    { command: "xclip", args: ["-selection", "clipboard", "-t", "image/png", "-o"] },
    { command: "xsel", args: ["--clipboard", "--output"] },
  ]
}

function clipboardTextCommands(platform: NodeJS.Platform): Array<{ command: string; args: string[] }> {
  if (platform === "darwin") return [{ command: "pbpaste", args: [] }]
  if (platform === "win32") return [{ command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"] }]
  return [
    { command: "wl-paste", args: ["--no-newline", "--type", "text/plain"] },
    { command: "xclip", args: ["-selection", "clipboard", "-t", "text/plain", "-o"] },
    { command: "xsel", args: ["--clipboard", "--output"] },
  ]
}

function extensionMime(extension: string): ImageMimeType | undefined {
  const normalized = extension.toLowerCase()
  if (normalized === ".png") return "image/png"
  if (normalized === ".jpg" || normalized === ".jpeg") return "image/jpeg"
  if (normalized === ".gif") return "image/gif"
  if (normalized === ".webp") return "image/webp"
  return undefined
}

function detectImage(data: Buffer): Pick<ValidatedImage, "mimeType" | "extension"> | null {
  if (data.length >= 20 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.includes(Buffer.from("IEND"), 8)) return { mimeType: "image/png", extension: ".png" }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data.at(-2) === 0xff && data.at(-1) === 0xd9) return { mimeType: "image/jpeg", extension: ".jpg" }
  if (data.length >= 14 && (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a") && data.at(-1) === 0x3b) return { mimeType: "image/gif", extension: ".gif" }
  if (data.length >= 20 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP" && data.readUInt32LE(4) + 8 <= data.length) return { mimeType: "image/webp", extension: ".webp" }
  return null
}

function runClipboardCommand(command: string, args: string[]) {
  return new Promise<{ ok: boolean; data: Buffer; error: string }>((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    const output: Buffer[] = []
    let error = ""
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString() })
    child.on("error", (value) => resolve({ ok: false, data: Buffer.alloc(0), error: value.message }))
    child.on("close", (code) => resolve({ ok: code === 0, data: Buffer.concat(output), error: error.trim() || `exit code ${code}` }))
  })
}
