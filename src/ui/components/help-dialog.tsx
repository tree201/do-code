import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"
import { EFFORT_COMMAND, EXPORT_COMMAND, HELP_COMMAND, MODEL_COMMAND, PERMISSIONS_COMMAND, PLAN_COMMAND, RESUME_COMMAND, THINKING_COMMAND } from "../shortcut-command-policy.js"
import { wrapTerminalLines } from "../terminal-text.js"
import { tuiTheme } from "../theme.js"

export function shortcutHelpText(language: DoCodeLanguage) {
  if (language === "zh") return [
    "输入与编辑",
    "Enter              发送消息",
    "Ctrl+Enter           插入换行",
    "Ctrl+J / Alt+Enter   兼容换行",
    "Ctrl+A / Ctrl+E     移到行首 / 行尾",
    "Ctrl+U              清空输入",
    "Ctrl+Z / Ctrl+Y     撤销 / 重做",
    "Backspace           删除前一个字符",
    "",
    "模型与模式",
    "Ctrl+R              切换思考强度",
    "Shift+Tab           切换 Plan 模式",
    "Ctrl+T              查看全部消息",
    "Ctrl+V              粘贴剪贴板图片",
    "",
    "命令与会话",
    `${HELP_COMMAND}               查看命令帮助`,
    `${MODEL_COMMAND}              查看或切换模型`,
    `${EFFORT_COMMAND}              设置思考强度`,
    `${THINKING_COMMAND}            切换思考模式`,
    `${PLAN_COMMAND}                进入或退出 Plan 模式`,
    `${PERMISSIONS_COMMAND}         设置模型权限`,
    `${RESUME_COMMAND}              恢复历史会话`,
    `${EXPORT_COMMAND}              导出当前会话`,
    "@路径                添加工作区文件",
    "!命令                直接执行 Shell 命令",
    "",
    "帮助弹窗",
    "Ctrl+H              关闭帮助",
    "Esc                 关闭帮助",
    "↑↓                  上下滚动",
    "PgUp / PgDn         翻页",
    "Home / End          跳到开头 / 结尾",
  ].join("\n")
  return [
    "Input and editing",
    "Enter              Send message",
    "Ctrl+Enter           Insert newline",
    "Ctrl+J / Alt+Enter   Compatible newline",
    "Ctrl+A / Ctrl+E     Move to line start / end",
    "Ctrl+U              Clear input",
    "Ctrl+Z / Ctrl+Y     Undo / redo",
    "Backspace           Delete the previous character",
    "",
    "Model and modes",
    "Ctrl+R              Cycle reasoning effort",
    "Shift+Tab           Toggle Plan mode",
    "Ctrl+T              View all messages",
    "Ctrl+V              Paste clipboard image",
    "",
    "Commands and sessions",
    `${HELP_COMMAND}               Show command help`,
    `${MODEL_COMMAND}              Show or switch models`,
    `${EFFORT_COMMAND}             Set reasoning effort`,
    `${THINKING_COMMAND}           Switch thinking mode`,
    `${PLAN_COMMAND}               Enter or leave Plan mode`,
    `${PERMISSIONS_COMMAND}        Set model permissions`,
    `${RESUME_COMMAND}             Resume a previous session`,
    `${EXPORT_COMMAND}             Export the current session`,
    "@path               Attach a workspace file",
    "!command            Run a Shell command directly",
    "",
    "Help dialog",
    "Ctrl+H              Close help",
    "Esc                 Close help",
    "↑↓                  Scroll",
    "PgUp / PgDn         Page up / down",
    "Home / End          Jump to the beginning / end",
  ].join("\n")
}

export function HelpDialog({ language, width, height, offset }: { language: DoCodeLanguage; width: number; height: number; offset: number }) {
  const zh = language === "zh"
  const contentWidth = Math.max(20, width - 4)
  const lines = wrapTerminalLines(shortcutHelpText(language), contentWidth)
  const rows = Math.max(5, Math.min(20, height - 8))
  const maximum = Math.max(0, lines.length - rows)
  const start = Math.min(maximum, Math.max(0, offset))
  const visible = lines.slice(start, start + rows)
  return (
    <DialogManager><DialogSurface>
      <Text bold color={tuiTheme.accent}>{zh ? "快捷键与操作帮助" : "Keyboard shortcuts and help"}<Text dimColor>  {lines.length ? `${start + 1}-${Math.min(lines.length, start + rows)}/${lines.length}` : "0/0"}</Text></Text>
      <Box flexDirection="column" marginTop={1} height={rows} overflow="hidden">
        {visible.map((line, index) => <Text key={`${start + index}-${line}`} wrap="truncate-end">{line || " "}</Text>)}
      </Box>
      <Text dimColor wrap="truncate-end">{zh ? "↑↓ · PgUp/PgDn · Home/End · Ctrl+H/Esc 关闭" : "↑↓ · PgUp/PgDn · Home/End · Ctrl+H/Esc Close"}</Text>
    </DialogSurface></DialogManager>
  )
}
