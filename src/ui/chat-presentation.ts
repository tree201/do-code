import type { DoCodeLanguage, ThinkingMode } from "../config.js"
import type { ApprovalMode } from "../policy.js"
import { t } from "./i18n.js"
import { displayWidth, truncateTerminal } from "./terminal-text.js"
import { LiveOutputViewport } from "./live-output-viewport.js"

export function preview(value: string, length = 900) {
  return truncateTerminal(value.trim(), length)
}

export function composerStatusText(options: {
  language: DoCodeLanguage
  running: boolean
  command: boolean
  width: number
  model: string
  reasoningIntensity?: string
  thinkingMode?: ThinkingMode
  contextPercent: number
  approvalMode: ApprovalMode
  planMode?: boolean
}) {
  const { language, width, contextPercent } = options
  const model = options.model.split("/").at(-1) ?? options.model
  const reasoningIntensity = options.reasoningIntensity ?? "default"
  const intensity = reasoningIntensity === "default" ? t(language, "default") : reasoningIntensity
  const context = `${contextPercent}%`
  const candidates = [
    [model, intensity, context, options.approvalMode],
    [model, context, options.approvalMode],
    [model, options.approvalMode],
    [options.approvalMode],
  ].map((parts) => parts.filter(Boolean).join(" · "))
  const available = Math.max(1, width - 4)
  return candidates.find((candidate) => displayWidth(candidate) <= available) ?? truncateTerminal(model, available)
}

export function formatElapsedTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  if (total < 60) return `${total}s`
  if (total < 3_600) {
    const minutes = Math.floor(total / 60)
    const remaining = total % 60
    return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`
  }
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor(total % 3_600 / 60)
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

export function inlineViewerHeight(terminalWidth: number, terminalHeight: number) {
  const desiredHeight = Math.floor(Math.max(terminalWidth * 0.2, 5))
  const availableHeight = Math.max(5, terminalHeight - 8)
  return Math.max(5, Math.min(desiredHeight, availableHeight))
}

export function boundedLiveOutput(value: string, width: number, maxRows: number) {
  const viewport = new LiveOutputViewport(width, maxRows)
  viewport.append(value)
  return viewport.value()
}
