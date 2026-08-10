import assert from "node:assert/strict"
import test from "node:test"
import { decodeToolHtml, fetchToolWeb, MAX_WEB_RESPONSE_BYTES, safeToolWebUrl, searchToolResults } from "../src/tool-web.js"

test("web tool URL validation blocks private targets and credentials", () => {
  assert.equal(safeToolWebUrl("https://example.com/docs").hostname, "example.com")
  assert.throws(() => safeToolWebUrl("http://127.0.0.1:8080"), /Private or local network host is blocked/)
  assert.throws(() => safeToolWebUrl("https://user:pass@example.com"), /URLs containing credentials are blocked/)
  assert.throws(() => safeToolWebUrl("file:///tmp/secret"), /Only HTTP\(S\) URLs are supported/)
})

test("web tool HTML decoding removes markup and normalizes whitespace", () => {
  assert.equal(decodeToolHtml("<h1>Title</h1><script>ignore()</script><p>A &amp; B</p>"), "Title\nA & B")
})

test("web search result parsing extracts titles, URLs, and snippets", () => {
  const html = '<a class="result__a" href="//example.com">Example &amp; Docs</a><div class="result__snippet">Useful <b>text</b></div>'
  assert.deepEqual(searchToolResults(html, 5), [{ title: "Example & Docs", url: "//example.com", snippet: "Useful text" }])
})

test("web transport revalidates redirect targets before following them", async () => {
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } })
  }
  try {
    await assert.rejects(fetchToolWeb("https://example.com/start"), /Private or local network host is blocked/)
    assert.equal(requests, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("web transport rejects oversized declared responses before reading the body", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response("small", {
    status: 200,
    headers: { "content-length": String(MAX_WEB_RESPONSE_BYTES + 1) },
  })
  try {
    await assert.rejects(fetchToolWeb("https://example.com/large"), /Response is too large/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
