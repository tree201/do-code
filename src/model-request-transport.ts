import { errorMessage } from "./model-openai-parsing.js"
import { isRetryableModelMessage, isRetryableModelRequestError, isRetryableModelStatus, retryAfterMilliseconds } from "./model-retry.js"

export const MODEL_REQUEST_MAX_RETRIES = 5
export const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 120_000

export class ModelRequestTimeoutError extends Error {
  readonly code = "ETIMEDOUT" as const
  constructor(readonly timeoutMs: number) {
    super(`Model request did not return response headers within ${timeoutMs}ms`)
    this.name = "ModelRequestTimeoutError"
  }
}

type ModelRetryConfig = { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number; jitter?: number }

export function abortableDelay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"))
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export async function fetchModelResponse(url: string, init: RequestInit, retry: ModelRetryConfig = {}, timeoutMs = DEFAULT_MODEL_REQUEST_TIMEOUT_MS, onRetry?: (attempt: number, delayMs: number, message?: string) => void) {
  const maxRetries = retry.maxRetries ?? MODEL_REQUEST_MAX_RETRIES
  const baseDelayMs = retry.baseDelayMs ?? 1_000
  const maxDelayMs = retry.maxDelayMs ?? 16_000
  const jitter = retry.jitter ?? 0.3
  const signal = init.signal ?? undefined
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    let timedOut = false
    const abortFromParent = () => controller.abort(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
    if (signal?.aborted) abortFromParent()
    else signal?.addEventListener("abort", abortFromParent, { once: true })
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true
      controller.abort(new ModelRequestTimeoutError(timeoutMs))
    }, timeoutMs) : undefined
    timer?.unref?.()
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      if (timer) clearTimeout(timer)
      signal?.removeEventListener("abort", abortFromParent)
      const retryableStatus = isRetryableModelStatus(response.status)
      let responseMessage: string | undefined
      if (!response.ok) {
        const body = await response.clone().json().catch(() => ({})) as { error?: { message?: string }; message?: string }
        responseMessage = body.error?.message ?? body.message
      }
      if ((!retryableStatus && !isRetryableModelMessage(responseMessage)) || attempt === maxRetries) return response
      const serverDelay = retryAfterMilliseconds(response)
      await response.body?.cancel().catch(() => undefined)
      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      const randomizedDelay = Math.max(0, exponentialDelay * (1 + jitter * (Math.random() * 2 - 1)))
      const delayMs = Math.max(serverDelay ?? 0, randomizedDelay)
      onRetry?.(attempt + 1, delayMs, responseMessage)
      await abortableDelay(delayMs, signal)
    } catch (error) {
      const effectiveError = timedOut ? new ModelRequestTimeoutError(timeoutMs) : error
      lastError = effectiveError
      const message = errorMessage(effectiveError, "")
      if (attempt === maxRetries || (!isRetryableModelRequestError(effectiveError) && !isRetryableModelMessage(message))) throw effectiveError
      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      const randomizedDelay = Math.max(0, exponentialDelay * (1 + jitter * (Math.random() * 2 - 1)))
      onRetry?.(attempt + 1, randomizedDelay, message)
      await abortableDelay(randomizedDelay, signal)
    } finally {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener("abort", abortFromParent)
    }
  }
  throw lastError
}
