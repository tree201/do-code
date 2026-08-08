import stringWidth from "string-width"

export function displayWidth(value: string) {
  return stringWidth(value)
}

export function padTerminalEnd(value: string, width: number) {
  return `${value}${" ".repeat(Math.max(0, width - displayWidth(value)))}`
}

export function truncateTerminal(value: string, width: number, suffix = "…") {
  if (width <= 0) return ""
  if (displayWidth(value) <= width) return value
  const suffixWidth = displayWidth(suffix)
  const target = Math.max(0, width - suffixWidth)
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
  let output = ""
  for (const { segment } of segmenter.segment(value)) {
    if (displayWidth(output + segment) > target) break
    output += segment
  }
  return `${output}${suffix}`
}

export function truncateTerminalStart(value: string, width: number, prefix = "…") {
  if (width <= 0) return ""
  if (displayWidth(value) <= width) return value
  const prefixWidth = displayWidth(prefix)
  const target = Math.max(0, width - prefixWidth)
  const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map(({ segment }) => segment)
  let output = ""
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index] ?? ""
    if (displayWidth(segment + output) > target) break
    output = segment + output
  }
  return `${prefix}${output}`
}

/** Wrap text by terminal display cells so Chinese and emoji do not split incorrectly. */
export function wrapTerminalLines(value: string, width: number) {
  const target = Math.max(1, width)
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
  const output: string[] = []
  for (const sourceLine of value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    if (!sourceLine) { output.push(""); continue }
    let line = ""
    let lineWidth = 0
    for (const { segment } of segmenter.segment(sourceLine)) {
      const segmentWidth = displayWidth(segment)
      if (line && lineWidth + segmentWidth > target) {
        output.push(line)
        line = segment
        lineWidth = segmentWidth
      } else {
        line += segment
        lineWidth += segmentWidth
      }
    }
    output.push(line)
  }
  return output.length ? output : [""]
}
