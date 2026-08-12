import { stripAttachmentTokens, type ComposerDraft } from "./attachment-model.js"

export function draftHasContent(draft: ComposerDraft) {
  return Boolean(stripAttachmentTokens(draft.value).trim()) || draft.nodes.length > 0
}

export function enqueueMessage(queue: ComposerDraft[], draft: ComposerDraft) {
  return draftHasContent(draft) ? [...queue, draft] : queue
}

export function takeNextMessage(queue: ComposerDraft[]) {
  return queue.length ? { message: queue[0]!, queue: queue.slice(1) } : { message: undefined, queue }
}

export function takeLastMessage(queue: ComposerDraft[]) {
  return queue.length ? { message: queue.at(-1)!, queue: queue.slice(0, -1) } : { message: undefined, queue }
}
