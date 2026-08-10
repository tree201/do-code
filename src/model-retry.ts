const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EPROTO",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT", "ERR_STREAM_PREMATURE_CLOSE",
])

export const MODEL_API_TIMEOUT_ENV = "DO_CODE_API_TIMEOUT_MS"
export const MODEL_STREAM_IDLE_TIMEOUT_ENV = "DO_CODE_STREAM_IDLE_TIMEOUT_MS"
export const LOW_THINKING_BUDGET = 1024
export const MEDIUM_THINKING_BUDGET = 4096
export const DEFAULT_THINKING_BUDGET = 8192

export function configuredModelTimeout(explicit: number | undefined, environmentName: string, fallback: number) {
  if (explicit !== undefined) return explicit
  const raw = process.env[environmentName]?.trim()
  if (raw && /^\d+$/.test(raw)) {
    const value = Number(raw)
    if (Number.isSafeInteger(value)) return value
  }
  return fallback
}

function networkErrorCode(error: unknown) {
  let current = error
  for (let depth = 0; depth < 6; depth++) {
    if (typeof current !== "object" || current === null) return undefined
    if ("code" in current && typeof current.code === "string") return current.code
    if (!("cause" in current)) return undefined
    current = current.cause
  }
  return undefined
}

export function isRetryableModelRequestError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return false
  const code = networkErrorCode(error)
  if (code && (RETRYABLE_NETWORK_CODES.has(code) || /^ERR_SSL_.*BAD_RECORD_MAC/i.test(code))) return true
  return error instanceof TypeError || (error instanceof Error && error.message.toLowerCase().includes("fetch failed"))
}

export function isRetryableModelStatus(status: number) {
  return status === 429 || status === 499 || (status >= 500 && status < 600)
}

export function isRetryableModelMessage(message: unknown) {
  return typeof message === "string" && /auth_unavailable|no auth available|unavailable|overloaded|temporarily unavailable|try your request again|retry your request|fetch failed|network error|connection (?:reset|refused|lost)|socket hang up|timed? out/i.test(message)
}

export function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get("retry-after")?.trim()
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}
