import React from "react"
import { render } from "ink"
import { createPausableOutput } from "./pausable-output.js"
import { enableEnhancedKeyboardInput } from "./enhanced-keyboard-input.js"
import { AlternateTranscriptViewer, ViewerInputBridge, type ViewerInputKey } from "./components/transcript-viewer.js"
import type { DoCodeLanguage } from "../config.js"
import type { TranscriptItem } from "./transcript-model.js"

export const INTERACTIVE_RENDER_OPTIONS = { exitOnCtrlC: false, patchConsole: false } as const

export function createInteractiveRenderer(createApp: () => React.ReactElement) {
  const mainOutput = createPausableOutput(process.stdout)
  let mainInstance: ReturnType<typeof render> | undefined
  let restoreKeyboardInput: (() => void) | undefined
  let revision = 0
  let alternateOpen = false
  let viewerInput: ((input: string, key: ViewerInputKey) => void) | undefined

  const openTranscriptViewer = async (items: TranscriptItem[], language: DoCodeLanguage) => {
    if (alternateOpen) return
    alternateOpen = true
    mainInstance?.clear(); mainOutput.pause()
    let closeViewer: (() => void) | undefined
    const closed = new Promise<void>((resolve) => { closeViewer = resolve })
    const inputBridge = new ViewerInputBridge()
    viewerInput = (input, key) => inputBridge.dispatch(input, key)
    let viewer: ReturnType<typeof render> | undefined
    let restored = false
    const restorePrimary = () => { if (restored) return; restored = true; process.stdout.write("\u001b[?7h\u001b[?1049l") }
    process.once("exit", restorePrimary)
    try {
      process.stdout.write("\u001b[?1049h\u001b[?7l\u001b[2J\u001b[H")
      viewer = render(<AlternateTranscriptViewer items={items} language={language} onClose={() => closeViewer?.()} inputBridge={inputBridge} />, {
        stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, exitOnCtrlC: false, patchConsole: false, standardReactLayoutTiming: true,
      })
      await closed
    } finally {
      if (viewer) { viewer.clear(); viewer.unmount() }
      restorePrimary(); process.off("exit", restorePrimary)
      viewerInput = undefined; alternateOpen = false; mainOutput.resume(); mainInstance?.rerender(createApp())
    }
  }

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
    forwardViewerInput(input: string, key: ViewerInputKey) { viewerInput?.(input, key) },
    revision() { return revision },
  }
}

export type InteractiveRenderer = ReturnType<typeof createInteractiveRenderer>
