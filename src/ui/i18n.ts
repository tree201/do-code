import type { DoCodeLanguage } from "../config.js"
import { localeDefinition, localeDefinitions } from "../locale-registry.js"

const zh: Record<string, string> = {
  "Show available commands": "查看可用命令",
  "Show workspace, model, and session status": "查看工作区、模型和会话状态",
  "Show or switch model presets": "查看或切换模型预设",
  "View or change language": "查看或切换语言",
  "Show custom commands and skills": "查看自定义命令和 Skills",
  "Capture a bad case and create an error ID": "记录 Bad Case 并生成错误 ID",
  "Show or reload layered AGENTS.md files": "查看或重载分层 AGENTS.md",
  "Restore the latest or a named file checkpoint": "恢复最近或指定的文件检查点",
  "Rewind chat, files, or both": "回退对话、文件或两者",
  "Show token, tool, and session statistics": "查看 Token、工具和会话统计",
  "Compact the current conversation context": "压缩当前对话上下文",
  "Trust the current workspace": "信任当前工作区",
  "Show active permission policy": "查看当前权限策略",
  "Show or switch the approval mode": "查看或切换审批模式",
  "Enter read-only planning or start planning a goal": "进入只读规划模式或开始制定目标计划",
  "Show current Git changes": "查看当前 Git 变更",
  "Clear conversation context": "清空对话上下文",
  "Browse and resume previous sessions": "浏览并恢复历史会话",
  "Rename the current session": "重命名当前会话",
  "Export the current session": "导出当前会话",
  "Show or switch reasoning effort": "查看或切换思考强度",
  "Show or switch thinking mode": "查看或切换思考模式",
  "Save the session and exit": "保存会话并退出",
  "let's do it!": "let's do it!",
  Model: "模型",
  Agent: "Agent",
  Workspace: "工作区",
  Session: "会话",
  resumed: "已恢复",
  Tip: "提示",
  "for commands": "打开命令",
  "to attach files": "添加文件",
  "for help": "查看帮助",
  "Current model": "当前模型",
  "Switch to this model": "切换到此模型",
  "Current reasoning effort": "当前思考强度",
  "Switch reasoning effort": "切换到此思考强度",
  "Current thinking mode": "当前思考模式",
  "Let the model decide when to think": "由模型自动决定是否思考",
  "Force thinking on": "强制开启思考",
  "Turn thinking off": "关闭思考",
  "Set interface and output language to English": "将界面与输出语言切换为英文",
  "Set interface and output language to Chinese": "将界面与输出语言切换为中文",
  "List loaded AGENTS.md instruction files": "列出已加载的 AGENTS.md 指令文件",
  "Show loaded project instructions": "查看已加载的项目指令",
  "Reload instructions from disk": "从磁盘重新加载指令",
  "Rewind conversation and files": "同时回退对话和文件",
  "Rewind conversation only": "仅回退对话",
  "Restore files only": "仅恢复文件",
  "Export the session as Markdown": "将会话导出为 Markdown",
  "Export the session as JSON": "将会话导出为 JSON",
  "Continue browsing this directory": "继续浏览此目录",
  "Add file context": "添加文件到上下文",
  "Current task is running; press Enter to queue a message": "任务正在运行；按 Enter 将消息加入队列",
  "Enter a task or @file path": "输入任务或 @文件路径",
  "Enter Command · Esc Interrupt": "Enter 执行命令 · Esc 中断",
  "Enter Queue · ↑ Recall · Esc Interrupt": "Enter 加入队列 · ↑ 召回 · Esc 中断",
  "Enter Send · Alt+Enter New line": "Enter 发送 · Ctrl+Enter 换行",
  "Thinking": "思考中",
  "Running": "正在执行",
  "Current language": "当前语言",
  "Available languages": "可用语言",
  "Language changed to Chinese.": "语言已切换为中文。",
  "Language changed to English.": "语言已切换为英文。",
  "Language setting failed": "语言设置失败",
  "Invalid language. Usage: /language [en|zh]": "无效语言。用法：/language [en|zh]",
}

export function t(language: DoCodeLanguage, value: string) {
  return language === "zh" ? zh[value] ?? value : value
}

export function languageDisplay(language: DoCodeLanguage, locale: DoCodeLanguage = language) {
  const definition = localeDefinition(language)
  return `${locale === "zh" ? definition.nativeName : definition.englishName} [${definition.bcp47}]`
}

export function availableLanguagesText(locale: DoCodeLanguage) {
  return localeDefinitions.map((language) => languageDisplay(language.id, locale)).join(", ")
}

export function languageUsageText() {
  return `/language [${localeDefinitions.map((language) => language.id).join("|")}]`
}

export function invalidLanguageText(locale: DoCodeLanguage) {
  return `${locale === "zh" ? "无效语言。用法" : "Invalid language. Usage"}: ${languageUsageText()}`
}
