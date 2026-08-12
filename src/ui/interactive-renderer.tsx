import React from "react"
import { render } from "ink"
import { createPausableOutput } from "./pausable-output.js"
import { enableEnhancedKeyboardInput } from "./enhanced-keyboard-input.js"
import { AlternateTranscriptViewer } from "./components/transcript-viewer.js"
import { AlternateHelpDialog } from "./components/help-dialog.js"
import { ViewportInputBridge, type ViewportInputKey } from "./viewport-surface.js"
import type { DoCodeLanguage } from "../config.js"
import type { TranscriptItem } from "./transcript-model.js"

export const INTERACTIVE_RENDER_OPTIONS = { exitOnCtrlC: false, patchConsole: false } as const

export function createInteractiveRenderer(createApp: () => React.ReactElement) {
  const mainOutput = createPausableOutput(process.stdout)
  let mainInstance: ReturnType<typeof render> | undefined
  let restoreKeyboardInput: (() => void) | undefined
  let revision = 0
  let viewportOpen = false
  let viewportInput: ((input: string, key: ViewportInputKey) => void) | undefined

  const openViewportSurface = async (surface: (onClose: () => void, inputBridge: ViewportInputBridge) => React.ReactElement) => {
    if (viewportOpen) return
    viewportOpen = true
    mainInstance?.clear()
    mainOutput.pause()
    let closeSurface: (() => void) | undefined
    const closed = new Promise<void>((resolve) => { closeSurface = resolve })
    const inputBridge = new ViewportInputBridge()
    viewportInput = (input, key) => inputBridge.dispatch(input, key)
    let instance: ReturnType<typeof render> | undefined
    let restored = false
    const restorePrimary = () => { if (restored) return; restored = true; process.stdout.write("\u001b[?7h\u001b[?1049l") }
    process.once("exit", restorePrimary)
    try {
      process.stdout.write("\u001b[?1049h\u001b[?7l\u001b[2J\u001b[H")
      instance = render(surface(() => closeSurface?.(), inputBridge), {
        stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, exitOnCtrlC: false, patchConsole: false, standardReactLayoutTiming: true,
      })
      await closed
    } finally {
      if (instance) { instance.clear(); instance.unmount() }
      restorePrimary()
      process.off("exit", restorePrimary)
      viewportInput = undefined
      viewportOpen = false
      mainOutput.resume()
      mainInstance?.rerender(createApp())
    }
  }

  const openTranscriptViewer = async (items: TranscriptItem[], language: DoCodeLanguage) => await openViewportSurface(
    (onClose, inputBridge) => <AlternateTranscriptViewer items={items} language={language} onClose={onClose} inputBridge={inputBridge} />,
  )
  const openHelp = async (language: DoCodeLanguage) => await openViewportSurface(
    (onClose, inputBridge) => <AlternateHelpDialog language={language} onClose={onClose} inputBridge={inputBridge} />,
  )

  return {
    start() {
      restoreKeyboardInput = enableEnhancedKeyboardInput()
      mainInstance = render(createApp(), { ...INTERACTIVE_RENDER_OPTIONS, stdout: mainOutput.stdout, stderr: process.stderr, stdin: process.stdin })
      return mainInstance
    },
    stop() {
      restoreKeyboardInput?.()
      restoreKeyboardInput = undefined
    },
    openTranscriptViewer,
    openHelp,
    forwardViewportInput(input: string, key: ViewportInputKey) { viewportInput?.(input, key) },
    revision() { return revision },
  }
}

export type InteractiveRenderer = ReturnType<typeof createInteractiveRenderer>
