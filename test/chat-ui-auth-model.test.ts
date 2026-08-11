import assert from "node:assert/strict"
import { stripVTControlCharacters } from "node:util"
import test from "node:test"
import React, { useCallback, useRef } from "react"
import { render } from "ink-testing-library"
import { useInput } from "ink"
import { AgentConversation } from "../src/agent.js"
import type { ChatModel } from "../src/protocol.js"
import { ApprovalBridge, ChatApp, type ChatAppProps } from "../src/ui/chat-app.js"
import { AuthDialog } from "../src/ui/components/auth-dialog.js"
import { ModelDialog } from "../src/ui/components/model-dialog.js"
import { EffortDialog } from "../src/ui/components/effort-dialog.js"
import { tick, visibleFrame, waitForFrame } from "./support/chat-ui.js"
import type { ChatInputKey } from "../src/ui/input-routing-types.js"

function DialogInputHarness({ children }: { children: (registerInputHandler: (handler: ((input: string, key: ChatInputKey) => void) | undefined) => void) => React.ReactNode }) {
  const handler = useRef<((input: string, key: ChatInputKey) => void) | undefined>(undefined)
  const registerInputHandler = useCallback((next: typeof handler.current) => { handler.current = next }, [])
  useInput((input, key) => handler.current?.(input, key as ChatInputKey))
  return children(registerInputHandler)
}

function renderAuthDialog(props: Omit<React.ComponentProps<typeof AuthDialog>, "registerInputHandler">) {
  return render(React.createElement(DialogInputHarness, { children: (registerInputHandler) => React.createElement(AuthDialog, { ...props, registerInputHandler }) }))
}

function renderModelDialog(props: Omit<React.ComponentProps<typeof ModelDialog>, "registerInputHandler">) {
  return render(React.createElement(DialogInputHarness, { children: (registerInputHandler) => React.createElement(ModelDialog, { ...props, registerInputHandler }) }))
}

function renderEffortDialog(props: Omit<React.ComponentProps<typeof EffortDialog>, "registerInputHandler">) {
  return render(React.createElement(DialogInputHarness, { children: (registerInputHandler) => React.createElement(EffortDialog, { ...props, registerInputHandler }) }))
}

test("auth dialog configures a provider without exposing the API key", async (t) => {
  let submitted: Parameters<NonNullable<React.ComponentProps<typeof AuthDialog>["onSubmit"]>>[0] | undefined
  let closed = false
  const view = renderAuthDialog({
    currentModel: "deepseek/deepseek-v4-pro",
    language: "zh",
    onClose: () => { closed = true },
    onSubmit: async (input) => {
      submitted = input
      return { source: "config", sourceLabel: "test", preset: "deepseek/deepseek-v4-pro", provider: "deepseek", modelId: "deepseek-v4-pro", baseUrl: "https://api.deepseek.com", apiKey: input.apiKey }
    },
  })
  t.after(() => view.unmount())
  assert.match(view.lastFrame() ?? "", /DeepSeek API/)
  view.stdin.write("\r")
  await tick()
  assert.match(view.lastFrame() ?? "", /API Key/)
  await new Promise((resolve) => setTimeout(resolve, 160))
  view.stdin.write("super-secret")
  const maskedFrame = await waitForFrame(view, /••••••••••••/)
  assert.doesNotMatch(maskedFrame, /super-secret/)
  assert.match(maskedFrame, /••••••••••••/)
  view.stdin.write("\r")
  await tick()
  assert.match(view.lastFrame() ?? "", /deepseek-v4-pro/)
  view.stdin.write("\r")
  await tick(); await tick()
  assert.equal(submitted?.providerId, "deepseek")
  assert.equal(submitted?.apiKey, "super-secret")
  assert.deepEqual(submitted?.modelIds, ["deepseek-v4-pro", "deepseek-v4-flash"])
  assert.equal(closed, true)
  view.unmount()
})

test("auth dialog returns to provider selection before closing", async () => {
  let closed = false
  const view = renderAuthDialog({
    currentModel: "ark-coding-plan/glm-5.2",
    language: "en",
    onClose: () => { closed = true },
    onSubmit: async () => { throw new Error("unused") },
  })
  view.stdin.write("\r")
  await tick()
  assert.match(view.lastFrame() ?? "", /API Key/)
  view.stdin.write("\u001b")
  await tick()
  assert.match(view.lastFrame() ?? "", /Connect a Provider/)
  assert.equal(closed, false)
  view.stdin.write("\u001b")
  await tick()
  assert.equal(closed, true)
  view.unmount()
})

test("auth dialog discovers models for a custom OpenAI-compatible provider", async () => {
  let submitted: Parameters<NonNullable<React.ComponentProps<typeof AuthDialog>["onSubmit"]>>[0] | undefined
  let discoveredBaseUrl = ""
  let discoveredApiKey = ""
  const view = renderAuthDialog({
    currentModel: "",
    language: "en",
    onClose: () => {},
    discoverModels: async (baseUrl, apiKey) => {
      discoveredBaseUrl = baseUrl
      discoveredApiKey = apiKey
      return ["model-a", "model-b"]
    },
    onSubmit: async (input) => {
      submitted = input
      return { source: "config", sourceLabel: "test", preset: "proxy/model-b", provider: "proxy", modelId: "model-b", baseUrl: input.baseUrl!, apiKey: input.apiKey }
    },
  })
  view.stdin.write("\r")
  await tick()
  view.stdin.write("\r")
  await tick()
  view.stdin.write("https://proxy.example/v1/\r")
  await tick()
  view.stdin.write("secret-key\r")
  await tick(); await tick()
  const frame = view.lastFrame() ?? ""
  assert.match(frame, /model-a/)
  assert.match(frame, /model-b/)
  assert.doesNotMatch(frame, /secret-key/)
  assert.equal(discoveredBaseUrl, "https://proxy.example/v1/")
  assert.equal(discoveredApiKey, "secret-key")
  view.stdin.write(" ")
  await tick()
  view.stdin.write("\r")
  await tick(); await tick()
  assert.equal(submitted?.providerId, "custom")
  assert.equal(submitted?.customProviderId, "proxy.example")
  assert.equal(submitted?.protocol, "openai-compatible")
  assert.deepEqual(submitted?.modelIds, ["model-b"])
  view.unmount()
})

test("auth dialog falls back to manual model IDs when discovery fails", async (t) => {
  let submitted: Parameters<NonNullable<React.ComponentProps<typeof AuthDialog>["onSubmit"]>>[0] | undefined
  const view = renderAuthDialog({
    currentModel: "",
    language: "zh",
    onClose: () => {},
    discoverModels: async () => { throw new Error("Model discovery failed with HTTP 401.") },
    onSubmit: async (input) => {
      submitted = input
      return { source: "config", sourceLabel: "test", preset: "proxy/manual-model", provider: "proxy", modelId: "manual-model", baseUrl: input.baseUrl!, apiKey: input.apiKey }
    },
  })
  t.after(() => view.unmount())
  view.stdin.write("\r")
  await tick()
  view.stdin.write("\r")
  await tick()
  view.stdin.write("https://proxy.example/v1\r")
  await tick()
  view.stdin.write("secret-key\r")
  const failureFrame = stripVTControlCharacters(await waitForFrame(view, /HTTP 401/))
  assert.match(failureFrame, /HTTP 401[\s\S]*手动输入模型 ID/)
  assert.doesNotMatch(failureFrame, /secret-key/)
  view.stdin.write("manual-model\r")
  await tick(); await tick()
  assert.deepEqual(submitted?.modelIds, ["manual-model"])
  view.unmount()
})

test("model dialog filters typed text and switches the highlighted model", async () => {
  let switched = ""
  const view = renderModelDialog({
    models: ["ark/glm-5.2", "ark/deepseek-v4-pro", "ark-coding-plan/deepseek-v4-pro"],
    currentModel: "ark/glm-5.2",
    language: "zh",
    onClose: () => {},
    onSelect: async (model) => { switched = model; return { source: "config", sourceLabel: "test", preset: model, provider: "ark", modelId: model, baseUrl: "https://example.com", apiKey: "test" } },
  })
  view.stdin.write("coding")
  await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /ark-coding-plan\/deepseek-v4-pro/)
  assert.doesNotMatch(view.lastFrame() ?? "", /○ ark\/deepseek-v4-pro/)
  view.stdin.write("\r")
  await tick(); await tick()
  assert.equal(switched, "ark-coding-plan/deepseek-v4-pro")
  view.unmount()
})

function effortDialogProps(sessionId: string): ChatAppProps {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  return {
    workspace: process.cwd(), model: "ark/glm-5.2", approvalMode: "ask", sessionId, restored: false,
    initialMessages: [], conversation, language: "en", modelPresets: ["ark/glm-5.2"], approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    configureAuth: async () => { throw new Error("unused") }, switchModel: async () => ({ source: "config", sourceLabel: "test", preset: "ark/glm-5.2", provider: "ark", modelId: "glm-5.2", baseUrl: "https://example.com", apiKey: "test" }),
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {}, reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
}

test("centralized input closes the model dialog for Kitty Escape", async (t) => {
  const view = render(React.createElement(ChatApp, effortDialogProps("session_model_escape")))
  t.after(() => view.unmount())
  view.stdin.write("/model\r")
  await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /Select Model/)
  view.stdin.write("[27;1u")
  await tick(); await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /Select Model/)
})

test("centralized input opens the effort dialog and closes it for Kitty Escape", async (t) => {
  const view = render(React.createElement(ChatApp, effortDialogProps("session_effort_escape")))
  t.after(() => view.unmount())
  view.stdin.write("/effort\r")
  await tick(); await tick()
  assert.match(view.lastFrame() ?? "", /Select Reasoning Effort/)
  view.stdin.write("[27;1u")
  await tick(); await tick()
  assert.doesNotMatch(view.lastFrame() ?? "", /Select Reasoning Effort/)
})

test("models installed by auth are immediately available to the model switcher", async () => {
  const model: ChatModel = { async complete() { return { content: "unused", toolCalls: [] } } }
  const conversation = new AgentConversation({ workspace: process.cwd(), model, approveShell: async () => false })
  let switched = ""
  const props: ChatAppProps = {
    workspace: process.cwd(), model: "deepseek/deepseek-v4-pro", approvalMode: "ask", sessionId: "session_auth_model", restored: false,
    initialMessages: [], conversation, language: "en", modelPresets: ["deepseek/deepseek-v4-pro"], approvalBridge: new ApprovalBridge(), attachEventSink: () => {},
    configureAuth: async (input) => ({ source: "config", sourceLabel: "test", preset: `deepseek/${input.modelIds![0]}`, provider: "deepseek", modelId: input.modelIds![0]!, baseUrl: "https://api.deepseek.com", apiKey: input.apiKey }),
    switchModel: async (preset) => { switched = preset; return { source: "config", sourceLabel: "test", preset, provider: "deepseek", modelId: preset.split("/").at(-1)!, baseUrl: "https://api.deepseek.com", apiKey: "test" } },
    runShellShortcut: async () => ({ ok: true, output: "" }), listSessions: async () => [], resumeSession: async () => { throw new Error("unused") },
    renameCurrentSession: async () => { throw new Error("unused") }, exportCurrentSession: async () => "unused", save: async () => {},
    reportError: async () => ({ id: "err_test", file: "/tmp/error.json" }),
  }
  const view = render(React.createElement(ChatApp, props))
  view.stdin.write("/auth\r")
  await tick(); await tick()
  view.stdin.write("\r")
  await tick()
  view.stdin.write("secret\r")
  await tick()
  view.stdin.write("\r")
  await tick(); await tick()

  view.stdin.write("/model\r")
  const modelFrame = await waitForFrame(view, /deepseek-v4-flash/)
  assert.match(modelFrame, /deepseek-v4-flash/)
  view.stdin.write("\u001b[B")
  await tick()
  view.stdin.write("\r")
  await tick(); await tick()
  assert.equal(switched, "deepseek/deepseek-v4-flash")
  assert.match(view.lastFrame() ?? "", /deepseek-v4-flash/)

  switched = ""
  view.stdin.write("/model deepseek/deepseek-v4-pro\r")
  await tick(); await tick()
  assert.equal(switched, "deepseek/deepseek-v4-pro")
  view.unmount()
})
