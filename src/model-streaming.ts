import type { ModelRequestOptions } from "./protocol.js"

export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 120_000

export class StreamInactivityTimeoutError extends Error {
  readonly code = "ETIMEDOUT" as const
  constructor(readonly idleMs: number, readonly chunksReceived: number, readonly streamLifetimeMs: number) {
    super(`No model stream activity for ${idleMs}ms after ${chunksReceived} chunks (stream lifetime: ${streamLifetimeMs}ms)`)
    this.name = "StreamInactivityTimeoutError"
  }
}

export async function* streamWithInactivityTimeout(
  body: ReadableStream<Uint8Array>,
  idleMs: number,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  const startedAt = Date.now()
  let chunksReceived = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const next = reader.read()
      let timer: ReturnType<typeof setTimeout> | undefined
      let removeAbort: (() => void) | undefined
      const guards: Promise<never>[] = []
      if (idleMs > 0) guards.push(new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new StreamInactivityTimeoutError(idleMs, chunksReceived, Date.now() - startedAt)), idleMs)
        timer.unref?.()
      }))
      if (signal) guards.push(new Promise<never>((_resolve, reject) => {
        const abort = () => reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"))
        signal.addEventListener("abort", abort, { once: true })
        removeAbort = () => signal.removeEventListener("abort", abort)
      }))
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await Promise.race([next, ...guards])
      } catch (error) {
        void reader.cancel(error).catch(() => undefined)
        void next.catch(() => undefined)
        throw error
      } finally {
        if (timer) clearTimeout(timer)
        removeAbort?.()
      }
      if (result.done) return
      chunksReceived++
      yield result.value
    }
  } finally {
    reader.releaseLock()
  }
}

export async function consumeSse(
  body: ReadableStream<Uint8Array>,
  optionsOrConsume: ModelRequestOptions | ((data: string) => void),
  consumeOrIdle: ((data: string) => void) | number,
  idleTimeoutMs = 120_000,
) {
  const options = typeof optionsOrConsume === "function" ? {} : optionsOrConsume
  const consume = typeof optionsOrConsume === "function" ? optionsOrConsume : consumeOrIdle as (data: string) => void
  const idleMs = typeof optionsOrConsume === "function" ? consumeOrIdle as number : idleTimeoutMs
  let buffer = ""
  let eventData: string[] = []
  const decoder = new TextDecoder()
  const flush = () => {
    if (!eventData.length) return
    const data = eventData.join("\n").trim()
    eventData = []
    if (data && data !== "[DONE]") consume(data)
  }
  for await (const chunk of streamWithInactivityTimeout(body, idleMs, options.signal)) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) { flush(); continue }
      if (line.startsWith("data:")) eventData.push(line.slice(5).trimStart())
    }
  }
  buffer += decoder.decode()
  for (const line of buffer.split(/\r?\n/)) {
    if (!line.trim()) { flush(); continue }
    if (line.startsWith("data:")) eventData.push(line.slice(5).trimStart())
  }
  flush()
}
