import assert from "node:assert/strict"
import { createServer, type RequestListener } from "node:http"
import test from "node:test"
import { discoverProviderModels } from "../src/provider-model-discovery.js"

async function serve(handler: RequestListener) {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Test server did not bind to TCP")
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1/`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

test("OpenAI-compatible model discovery authenticates, normalizes the URL, and deduplicates IDs", async () => {
  let requestedUrl = ""
  let authorization = ""
  const server = await serve((request, response) => {
    requestedUrl = request.url ?? ""
    authorization = request.headers.authorization ?? ""
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify({ data: [{ id: "model-a" }, { id: " model-b " }, { id: "model-a" }, { name: "ignored" }] }))
  })
  try {
    assert.deepEqual(await discoverProviderModels(server.baseUrl, "secret-key"), ["model-a", "model-b"])
    assert.equal(requestedUrl, "/v1/models")
    assert.equal(authorization, "Bearer secret-key")
  } finally {
    await server.close()
  }
})

test("model discovery reports HTTP failures without exposing response or credential content", async () => {
  const server = await serve((_request, response) => {
    response.statusCode = 401
    response.end(JSON.stringify({ error: "secret-key was rejected" }))
  })
  try {
    await assert.rejects(discoverProviderModels(server.baseUrl, "secret-key"), (error: Error) => {
      assert.match(error.message, /HTTP 401/)
      assert.doesNotMatch(error.message, /secret-key|rejected/)
      return true
    })
  } finally {
    await server.close()
  }
})

test("model discovery rejects malformed and empty model lists", async (context) => {
  await context.test("malformed response", async () => {
    const server = await serve((_request, response) => response.end(JSON.stringify({ models: [{ id: "model-a" }] })))
    try {
      await assert.rejects(discoverProviderModels(server.baseUrl, "secret"), /invalid model list/)
    } finally {
      await server.close()
    }
  })
  await context.test("empty response", async () => {
    const server = await serve((_request, response) => response.end(JSON.stringify({ data: [] })))
    try {
      await assert.rejects(discoverProviderModels(server.baseUrl, "secret"), /returned no models/)
    } finally {
      await server.close()
    }
  })
})

test("model discovery times out stalled requests", async () => {
  const server = await serve(() => {})
  try {
    await assert.rejects(discoverProviderModels(server.baseUrl, "secret", 20), /timed out after 20ms/)
  } finally {
    await server.close()
  }
})
