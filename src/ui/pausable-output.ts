export type PausableOutput = {
  stdout: NodeJS.WriteStream
  pause: () => void
  resume: (replay?: boolean) => void
}

/**
 * Give the long-lived inline renderer its own stream identity so a temporary
 * alternate-buffer Ink instance can coexist with it.
 */
export function createPausableOutput(target: NodeJS.WriteStream): PausableOutput {
  let paused = false
  let pending: Array<string | Uint8Array> = []
  const stdout = new Proxy(target, {
    get(stream, property) {
      if (property === "write") {
        return (...args: unknown[]) => {
          if (!paused) return (stream.write as (...values: unknown[]) => boolean).apply(stream, args)
          const chunk = args[0]
          if (typeof chunk === "string" || chunk instanceof Uint8Array) pending.push(chunk)
          const callback = [...args].reverse().find((value) => typeof value === "function") as (() => void) | undefined
          if (callback) queueMicrotask(callback)
          return true
        }
      }
      const value = Reflect.get(stream, property, stream) as unknown
      return typeof value === "function" ? value.bind(stream) : value
    },
    set(stream, property, value) {
      return Reflect.set(stream, property, value, stream)
    },
  }) as NodeJS.WriteStream
  return {
    stdout,
    pause: () => {
      if (paused) return
      pending = []
      paused = true
    },
    resume: (replay = true) => {
      paused = false
      if (!pending.length) return
      if (!replay) {
        pending = []
        return
      }
      target.write("\u001b[?2026h")
      for (const chunk of pending) target.write(chunk)
      target.write("\u001b[?2026l")
      pending = []
    },
  }
}
