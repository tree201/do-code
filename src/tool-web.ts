import { isIP } from "node:net"

export const MAX_WEB_RESPONSE_BYTES = 1_000_000
export const MAX_WEB_REDIRECT_COUNT = 5
const HTTP_REDIRECT_MIN = 300
const HTTP_REDIRECT_MAX = 400

export type ToolWebResponse = { url: string; contentType: string; body: string }

function privateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "")
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true
  const version = isIP(normalized)
  if (version === 4) {
    const [a = 0, b = 0] = normalized.split(".").map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  if (version === 6) return normalized === "::1" || normalized === "::" || /^f[cd]/i.test(normalized) || /^fe[89ab]/i.test(normalized)
  return false
}

export function safeToolWebUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP(S) URLs are supported")
  if (url.username || url.password) throw new Error("URLs containing credentials are blocked")
  if (privateHostname(url.hostname)) throw new Error(`Private or local network host is blocked: ${url.hostname}`)
  return url
}

export function decodeToolHtml(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim()
}

export function searchToolResults(html: string, limit: number) {
  const results: Array<{ title: string; url: string; snippet: string }> = []
  const links = [...html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  for (const match of links.slice(0, limit)) {
    const rawUrl = match[1] ?? ""
    const redirected = (() => { try { return new URL(rawUrl, "https://duckduckgo.com").searchParams.get("uddg") ?? rawUrl } catch { return rawUrl } })()
    const tail = html.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 1800)
    const snippetMatch = /<(?:a|div)[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(tail)
    results.push({ title: decodeToolHtml(match[2] ?? ""), url: redirected, snippet: decodeToolHtml(snippetMatch?.[1] ?? "") })
  }
  return results
}

export async function fetchToolWeb(urlValue: string, timeoutMs = 20_000, redirects = 0): Promise<ToolWebResponse> {
  if (redirects > MAX_WEB_REDIRECT_COUNT) throw new Error(`Too many redirects (limit ${MAX_WEB_REDIRECT_COUNT})`)
  const url = safeToolWebUrl(urlValue)
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException("Web request timed out", "TimeoutError")),
    Math.min(Math.max(timeoutMs, 1_000), 60_000),
  )
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        "user-agent": "do-code/0.3 (+https://github.com/do-code)",
        accept: "text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1",
      },
    })
    if (response.status >= HTTP_REDIRECT_MIN && response.status < HTTP_REDIRECT_MAX) {
      const location = response.headers.get("location")
      if (!location) throw new Error(`Redirect ${response.status} did not include a Location header`)
      return await fetchToolWeb(new URL(location, url).toString(), timeoutMs, redirects + 1)
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    const length = Number(response.headers.get("content-length") ?? 0)
    if (length > MAX_WEB_RESPONSE_BYTES) throw new Error(`Response is too large: ${length} bytes (limit ${MAX_WEB_RESPONSE_BYTES})`)
    const reader = response.body?.getReader()
    if (!reader) return { url: response.url || url.toString(), contentType: response.headers.get("content-type") ?? "", body: "" }
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > MAX_WEB_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error(`Response exceeded ${MAX_WEB_RESPONSE_BYTES} bytes`)
      }
      chunks.push(next.value)
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
    return { url: response.url || url.toString(), contentType: response.headers.get("content-type") ?? "", body }
  } finally {
    clearTimeout(timer)
  }
}
