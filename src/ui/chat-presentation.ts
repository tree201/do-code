import type { DoCodeLanguage, ThinkingMode } from "../config.js"
import type { ApprovalMode } from "../policy.js"
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
  const intensity = language === "zh" && reasoningIntensity === "default" ? "默认" : reasoningIntensity
  const context = `${contextPercent}%`
  const candidates = [
    [model, intensity, context],
    [model, context],
    [model],
  ].map((parts) => parts.filter(Boolean).join(" · "))
  const available = Math.max(1, width - 4)
  return candidates.find((candidate) => displayWidth(candidate) <= available) ?? truncateTerminal(model, available)
}

export function approvalModeNotice(mode: ApprovalMode, language: DoCodeLanguage) {
  const descriptions: Record<ApprovalMode, [string, string]> = {
    ask: [
      "允许读取和编辑当前工作区并运行普通命令；联网、工作区外访问和高风险操作会请求确认。",
      "Allow current-workspace reads, edits, and ordinary commands; ask before network, outside-workspace, and high-risk actions.",
    ],
    auto: [
      "自动执行普通编辑、Shell 和联网操作；仅对检测为可能不安全的操作请求确认。",
      "Automatically run ordinary edits, shell commands, and network access; ask only for potentially unsafe actions.",
    ],
    "full-access": [
      "允许编辑工作区外文件和访问网络，不再请求普通审批；灾难性系统命令仍会被阻止。",
      "Allow edits outside the workspace and network access without ordinary approval prompts; catastrophic system commands remain blocked.",
    ],
  }
  const labels: Record<ApprovalMode, string> = { ask: "请求批准", auto: "自动批准安全操作", "full-access": "完全访问" }
  const title = language === "zh" ? `审批模式：${labels[mode]}（${mode}）` : `Approval mode: ${mode}`
  return `${title}\n${descriptions[mode][language === "zh" ? 0 : 1]}`
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
