export type ViewportInputKey = {
  ctrl?: boolean
  escape?: boolean
  upArrow?: boolean
  downArrow?: boolean
  pageUp?: boolean
  pageDown?: boolean
  home?: boolean
  end?: boolean
}

export class ViewportInputBridge {
  private handler: ((input: string, key: ViewportInputKey) => void) | null = null

  attach(handler: ((input: string, key: ViewportInputKey) => void) | null) {
    this.handler = handler
  }

  dispatch(input: string, key: ViewportInputKey) {
    this.handler?.(input, key)
  }
}
