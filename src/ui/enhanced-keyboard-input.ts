type KeyboardInput = { isTTY?: boolean }
type KeyboardOutput = { isTTY?: boolean; write(chunk: string): unknown }
type ExitLifecycle = {
  once(event: "exit", listener: () => void): unknown
  off(event: "exit", listener: () => void): unknown
}

export const ENABLE_ENHANCED_KEYBOARD_INPUT = "\u001b[>1u\u001b[>4;2m"
export const DISABLE_ENHANCED_KEYBOARD_INPUT = "\u001b[>4m\u001b[<u"

export function enableEnhancedKeyboardInput(input: KeyboardInput = process.stdin, output: KeyboardOutput = process.stdout, lifecycle: ExitLifecycle = process) {
  if (!input.isTTY || !output.isTTY) return () => {}

  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    output.write(DISABLE_ENHANCED_KEYBOARD_INPUT)
  }

  output.write(ENABLE_ENHANCED_KEYBOARD_INPUT)
  lifecycle.once("exit", restore)
  return () => {
    restore()
    lifecycle.off("exit", restore)
  }
}
