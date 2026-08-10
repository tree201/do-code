export const DEFAULT_CAPTURE_LIMIT = 40_000

export class BoundedOutput {
  private head = ""
  private tail = ""
  private total = 0

  constructor(private readonly limit = DEFAULT_CAPTURE_LIMIT) {}

  append(value: string | Buffer) {
    const text = typeof value === "string" ? value : value.toString()
    if (!text) return
    this.total += text.length
    const headLimit = Math.ceil(this.limit / 2)
    const tailLimit = Math.floor(this.limit / 2)
    if (this.head.length < headLimit) {
      const remaining = headLimit - this.head.length
      this.head += text.slice(0, remaining)
    }
    this.tail = `${this.tail}${text}`.slice(-tailLimit)
  }

  value() {
    if (this.total <= this.limit) return `${this.head}${this.tail.slice(Math.max(0, this.head.length + this.tail.length - this.total))}`
    const omitted = this.total - this.head.length - this.tail.length
    return `${this.head}\n\n... ${omitted} characters omitted ...\n\n${this.tail}`
  }

  get length() { return this.total }
}

export function boundedOutput(value: string, limit = DEFAULT_CAPTURE_LIMIT) {
  const output = new BoundedOutput(limit)
  output.append(value)
  return output.value()
}
