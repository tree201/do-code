export type ImageAttachment = { reference: string; name: string; size?: number }

export function attachmentIndex(attachments: ImageAttachment[], query: string) {
  const normalized = query.trim()
  return /^\d+$/.test(normalized)
    ? Number(normalized) - 1
    : attachments.findIndex((image) => image.name === normalized || image.reference === normalized)
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
