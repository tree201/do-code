export function enqueueMessage(queue: string[], value: string) {
  const message = value.trim()
  return message ? [...queue, message] : queue
}

export function takeNextMessage(queue: string[]) {
  return queue.length ? { message: queue[0]!, queue: queue.slice(1) } : { message: undefined, queue }
}

export function takeLastMessage(queue: string[]) {
  return queue.length ? { message: queue.at(-1)!, queue: queue.slice(0, -1) } : { message: undefined, queue }
}
