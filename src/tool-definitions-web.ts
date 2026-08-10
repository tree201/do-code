import type { ToolImplementation } from "./tool-contracts.js"
import { toolSchema } from "./tool-definition-helpers.js"
import { optionalNumber, text, truncateToolOutput } from "./tool-input.js"
import { decodeToolHtml, fetchToolWeb, searchToolResults } from "./tool-web.js"
import { TOOL_NAMES } from "./tool-names.js"

const webFetchTool: ToolImplementation = {
  definition: {
    type: "function",
    function: {
      name: TOOL_NAMES.WEB_FETCH,
      description: "Fetch a public HTTP(S) page and return readable text. Local/private network targets and oversized responses are blocked.",
      parameters: toolSchema({ url: { type: "string", description: "Public HTTP(S) URL" }, timeout_ms: { type: "integer", minimum: 1000, maximum: 60000 } }, ["url"]),
    },
  },
  async execute(args) {
    const fetched = await fetchToolWeb(text(args, "url"), optionalNumber(args, "timeout_ms") ?? 20_000)
    const readable = /html/i.test(fetched.contentType) ? decodeToolHtml(fetched.body) : fetched.body.trim()
    return { ok: true, output: truncateToolOutput(`URL: ${fetched.url}\nContent-Type: ${fetched.contentType || "unknown"}\n\n${readable || "(empty response)"}`) }
  },
}

const webSearchTool: ToolImplementation = {
  definition: {
    type: "function",
    function: {
      name: TOOL_NAMES.WEB_SEARCH,
      description: "Search the public web for current technical documentation and error information. Returns titles, URLs, and snippets.",
      parameters: toolSchema({ query: { type: "string" }, max_results: { type: "integer", minimum: 1, maximum: 10 } }, ["query"]),
    },
  },
  async execute(args) {
    const query = text(args, "query").trim()
    if (!query) return { ok: false, output: "Search query must not be empty" }
    const limit = Math.min(Math.max(optionalNumber(args, "max_results") ?? 5, 1), 10)
    const fetched = await fetchToolWeb(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`)
    const results = searchToolResults(fetched.body, limit)
    return {
      ok: true,
      output: results.length
        ? results.map((result, index) => `${index + 1}. ${result.title}\n${result.url}${result.snippet ? `\n${result.snippet}` : ""}`).join("\n\n")
        : "No search results found",
    }
  },
}

export const webTools = [webFetchTool, webSearchTool] satisfies ToolImplementation[]
