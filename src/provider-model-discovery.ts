export async function discoverProviderModels(baseUrl: string, apiKey: string, timeoutMs = 3_000) {
  const endpoint = `${baseUrl.trim().replace(/\/+$/, "")}/models`
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error("The Base URL is not a valid HTTP(S) URL.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The Base URL is not a valid HTTP(S) URL.")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Model discovery timed out after ${timeoutMs}ms.`)
    throw new Error("Unable to connect to the provider model endpoint.")
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`Model discovery failed with HTTP ${response.status}.`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error("The provider returned an invalid model list.")
  }
  if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) {
    throw new Error("The provider returned an invalid model list.")
  }
  const models = [...new Set(payload.data.flatMap((item) => {
    if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string") return []
    const id = item.id.trim()
    return id ? [id] : []
  }))]
  if (!models.length) throw new Error("The provider returned no models.")
  return models
}
