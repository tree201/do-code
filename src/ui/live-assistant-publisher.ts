type SchedulePublish = (publish: () => void) => () => void

const scheduleNextFrame: SchedulePublish = (publish) => {
  const timer = setTimeout(publish, 16)
  return () => { clearTimeout(timer) }
}

export function createLiveAssistantPublisher(publish: (value: string) => void, schedule: SchedulePublish = scheduleNextFrame) {
  let pendingValue = ""
  let cancelPending: (() => void) | null = null
  let generation = 0

  return {
    schedule(value: string) {
      pendingValue = value
      if (cancelPending) return
      const scheduledGeneration = ++generation
      cancelPending = schedule(() => {
        if (scheduledGeneration !== generation) return
        cancelPending = null
        publish(pendingValue)
      })
    },
    flush(value: string) {
      pendingValue = value
      generation++
      cancelPending?.()
      cancelPending = null
      publish(pendingValue)
    },
    cancel() {
      generation++
      cancelPending?.()
      cancelPending = null
    },
  }
}
