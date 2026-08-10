import { stripVTControlCharacters } from "node:util"

export const tick = () => new Promise((resolve) => setTimeout(resolve, 40))

export const visibleFrame = (view: { lastFrame(): string | undefined }) => stripVTControlCharacters(view.lastFrame() ?? "")

export async function waitForFrame(view: { lastFrame(): string | undefined }, pattern: RegExp) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const frame = view.lastFrame() ?? ""
    if (pattern.test(frame)) return frame
    await tick()
  }
  return view.lastFrame() ?? ""
}

export const currentScreen = (frame: string) => {
  const start = frame.lastIndexOf("›_ do-code")
  return start < 0 ? frame : frame.slice(start)
}
