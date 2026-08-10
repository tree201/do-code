import { displayWidth } from "./terminal-text.js"

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export type LiveOutputViewportValue = { text: string; truncated: boolean }

export class LiveOutputViewport {
  private completed: string[] = []
  private current = ""
  private currentWidth = 0
  private totalRows = 1

  constructor(private width: number, private rowLimit: number) {
    this.width = Math.max(12, width)
    this.rowLimit = Math.max(1, rowLimit)
  }

  append(value: string) {
    for (const { segment } of segmenter.segment(value.replaceAll("\r", ""))) {
      if (segment === "\n") { this.finishRow(); continue }
      const width = displayWidth(segment)
      if (this.current && this.currentWidth + width > this.width) this.finishRow()
      this.current += segment
      this.currentWidth += width
    }
  }

  reset(value: string, width = this.width, rowLimit = this.rowLimit) {
    this.width = Math.max(12, width)
    this.rowLimit = Math.max(1, rowLimit)
    this.completed = []
    this.current = ""
    this.currentWidth = 0
    this.totalRows = 1
    this.append(value)
  }

  value(): LiveOutputViewportValue {
    const rows = [...this.completed, this.current].slice(-this.rowLimit)
    return { text: rows.join("\n"), truncated: this.totalRows > this.rowLimit }
  }

  private finishRow() {
    this.completed.push(this.current)
    if (this.completed.length > this.rowLimit) this.completed.shift()
    this.current = ""
    this.currentWidth = 0
    this.totalRows++
  }
}
