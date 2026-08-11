import assert from "node:assert/strict"
import { stripVTControlCharacters } from "node:util"
import test from "node:test"
import React, { useCallback, useRef } from "react"
import { useInput } from "ink"
import { render } from "ink-testing-library"
import { AuthDialog } from "../src/ui/components/auth-dialog.js"
import { QueuedMessages } from "../src/ui/components/chat-activity.js"
import type { ChatInputKey } from "../src/ui/input-routing-types.js"
import { tick } from "./support/chat-ui.js"

function AuthDialogHarness() {
  const handler = useRef<((input: string, key: ChatInputKey) => void) | undefined>(undefined)
  const registerInputHandler = useCallback((next: typeof handler.current) => { handler.current = next }, [])
  useInput((input, key) => handler.current?.(input, key as ChatInputKey))
  return <AuthDialog
    currentModel="coding-plan/qwen3.5-plus"
    language="ja"
    onClose={() => {}}
    onSubmit={async () => { throw new Error("unused") }}
    registerInputHandler={registerInputHandler}
  />
}

test("queued messages localize queue status", (t) => {
  const view = render(<QueuedMessages messages={["one", "two", "three", "four"]} language="fr" />)
  t.after(() => view.unmount())
  const frame = stripVTControlCharacters(view.lastFrame() ?? "")
  assert.match(frame, /4 en attente/)
  assert.match(frame, /…et 1 de plus/)
  assert.doesNotMatch(frame, /queued|and 1 more/)
})

test("auth dialog localizes provider descriptions and regions", async (t) => {
  const view = render(<AuthDialogHarness />)
  t.after(() => view.unmount())
  const providers = stripVTControlCharacters(view.lastFrame() ?? "")
  assert.match(providers, /週次クォータ付き個人開発者プラン/)
  assert.doesNotMatch(providers, /个人开发者套餐|自定义 Provider/)
  view.stdin.write("\r")
  await tick()
  const regions = stripVTControlCharacters(view.lastFrame() ?? "")
  assert.match(regions, /中国（北京）|シンガポール（国際）/)
  assert.doesNotMatch(regions, /新加坡（国际）/)
})
