import assert from "node:assert/strict"
import test from "node:test"
import { checkForUpdate, compareVersions } from "../src/update.js"

test("compares stable and prerelease semantic versions", () => {
  assert.ok(compareVersions("0.3.0", "0.2.9") > 0)
  assert.ok(compareVersions("0.3.0-next.2", "0.3.0-next.1") > 0)
  assert.ok(compareVersions("0.3.0", "0.3.0-next.2") > 0)
})

test("checks stable and preview npm dist-tags", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ "dist-tags": { latest: "0.3.1", next: "0.4.0-next.1" } }), { status: 200, headers: { "content-type": "application/json" } })
  const stable = await checkForUpdate("stable", fetcher)
  assert.equal(stable.latest, "0.3.1")
  assert.equal(stable.updateAvailable, true)
  const preview = await checkForUpdate("preview", fetcher)
  assert.equal(preview.tag, "next")
  assert.equal(preview.latest, "0.4.0-next.1")
})
