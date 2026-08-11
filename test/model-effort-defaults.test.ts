import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import React, { useCallback, useRef } from "react"
import { render } from "ink-testing-library"
import { useInput } from "ink"
import { loadStoredConfig, saveDefaultReasoningEffort } from "../src/config.js"
import { EffortDialog } from "../src/ui/components/effort-dialog.js"
import { ModelDialog } from "../src/ui/components/model-dialog.js"
import type { ChatInputKey } from "../src/ui/input-routing-types.js"
import { tick, visibleFrame } from "./support/chat-ui.js"

function DialogInputHarness({ children }: { children: (registerInputHandler: (handler: ((input: string, key: ChatInputKey) => void) | undefined) => void) => React.ReactNode }) {
  const handler = useRef<((input: string, key: ChatInputKey) => void) | undefined>(undefined)
  const registerInputHandler = useCallback((next: typeof handler.current) => { handler.current = next }, [])
  useInput((input, key) => handler.current?.(input, key as ChatInputKey))
  return children(registerInputHandler)
}

function renderModelDialog(props: Omit<React.ComponentProps<typeof ModelDialog>, "registerInputHandler">) {
  return render(React.createElement(DialogInputHarness, { children: (registerInputHandler) => React.createElement(ModelDialog, { ...props, registerInputHandler }) }))
}

function renderEffortDialog(props: Omit<React.ComponentProps<typeof EffortDialog>, "registerInputHandler">) {
  return render(React.createElement(DialogInputHarness, { children: (registerInputHandler) => React.createElement(EffortDialog, { ...props, registerInputHandler }) }))
}

test("model and effort dialogs persist when Tab is immediately followed by Enter", async (t) => {
  let modelDefault = ""
  const modelView = renderModelDialog({
    models: ["ark/glm-5.2"], currentModel: "ark/glm-5.2", language: "en", onClose: () => {},
    onSelect: async (model) => ({ source: "config", sourceLabel: "test", preset: model, provider: "ark", modelId: model, baseUrl: "https://example.com", apiKey: "test" }),
    onPersist: async (model) => { modelDefault = model },
  })
  t.after(() => modelView.unmount())
  modelView.stdin.write("\t"); modelView.stdin.write("\r")
  await tick(); await tick(); await tick()
  assert.equal(modelDefault, "ark/glm-5.2")

  let effortDefault = ""
  const effortView = renderEffortDialog({
    efforts: ["low", "medium", "high", "xhigh", "max"], currentEffort: "medium", language: "en", onClose: () => {},
    onSelect: async (effort) => ({ source: "config", sourceLabel: "test", preset: "ark/glm-5.2", provider: "ark", modelId: "glm-5.2", baseUrl: "https://example.com", apiKey: "test", reasoningEffort: effort }),
    onPersist: async (effort) => { effortDefault = effort },
  })
  t.after(() => effortView.unmount())
  effortView.stdin.write("\t"); effortView.stdin.write("\r")
  await tick(); await tick(); await tick()
  assert.equal(effortDefault, "medium")
})

test("model dialog remembers a newly selected model", async (t) => {
  let switched = ""
  let persisted = ""
  const view = renderModelDialog({
    models: ["ark/glm-5.2", "ark/deepseek-v4-pro"], currentModel: "ark/glm-5.2", language: "en", onClose: () => {},
    onSelect: async (model) => { switched = model; return { source: "config", sourceLabel: "test", preset: model, provider: "ark", modelId: model, baseUrl: "https://example.com", apiKey: "test" } },
    onPersist: async (model) => { persisted = model },
  })
  t.after(() => view.unmount())
  view.stdin.write("\u001b[B"); await tick()
  view.stdin.write("\t"); await tick()
  view.stdin.write("\r"); await tick(); await tick(); await tick()
  assert.equal(switched, "ark/deepseek-v4-pro")
  assert.equal(persisted, "ark/deepseek-v4-pro")
})

test("effort dialog remembers the selected effort and marks the saved default", async (t) => {
  let switched = ""
  let persisted = ""
  const view = renderEffortDialog({
    efforts: ["low", "medium", "high", "xhigh", "max"], currentEffort: "medium", defaultEffort: "high", language: "en", onClose: () => {},
    onSelect: async (effort) => { switched = effort; return { source: "config", sourceLabel: "test", preset: "ark/glm-5.2", provider: "ark", modelId: "glm-5.2", baseUrl: "https://example.com", apiKey: "test", reasoningEffort: effort } },
    onPersist: async (effort) => { persisted = effort },
  })
  t.after(() => view.unmount())
  assert.match(visibleFrame(view), /high \(default\)/)
  view.stdin.write("\u001b[B"); await tick()
  view.stdin.write("\t"); await tick()
  view.stdin.write("\r"); await tick(); await tick(); await tick()
  assert.equal(switched, "high")
  assert.equal(persisted, "high")
})

test("saved default reasoning effort is written and loaded for a future session", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "do-code-effort-"))
  const configPath = path.join(directory, "config.json")
  const previous = process.env.DO_CODE_CONFIG_PATH
  process.env.DO_CODE_CONFIG_PATH = configPath
  t.after(async () => {
    if (previous === undefined) delete process.env.DO_CODE_CONFIG_PATH
    else process.env.DO_CODE_CONFIG_PATH = previous
    await rm(directory, { recursive: true, force: true })
  })

  await saveDefaultReasoningEffort("xhigh")
  const raw = JSON.parse(await readFile(configPath, "utf8")) as { defaultReasoningEffort?: string }
  assert.equal(raw.defaultReasoningEffort, "xhigh")
  assert.equal((await loadStoredConfig(directory)).defaultReasoningEffort, "xhigh")
})
