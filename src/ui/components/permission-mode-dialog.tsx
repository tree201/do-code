import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import type { ApprovalMode } from "../../policy.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"
import { tuiTheme } from "../theme.js"

export function PermissionModeDialog({ currentMode, selectedIndex, language }: { currentMode: ApprovalMode; selectedIndex: number; language: DoCodeLanguage }) {
  const zh = language === "zh"
  const modes: ApprovalMode[] = ["ask", "auto", "full-access"]
  const labels = zh ? ["请求批准", "自动批准安全操作", "完全访问"] : ["Ask for approval", "Approve for me", "Full Access"]
  const descriptions = zh
    ? [
        "可读取和编辑当前工作区并运行普通命令；访问网络或工作区外文件时请求确认。",
        "自动执行普通编辑、命令和联网操作；仅对检测为可能不安全的操作请求确认。",
        "可编辑工作区外文件并访问网络，不再请求普通审批。请谨慎使用。",
      ]
    : [
        "Read and edit the current workspace and run ordinary commands; ask before network or outside-workspace access.",
        "Automatically run ordinary edits, commands, and network access; ask only for potentially unsafe actions.",
        "Edit files outside the workspace and access the network without ordinary approval prompts. Use with caution.",
      ]
  return (
    <DialogManager><DialogSurface>
      <Text bold>{zh ? "更新模型权限" : "Update Model Permissions"}</Text>
      <Box marginTop={1} flexDirection="column">
        {modes.map((mode, index) => {
          const selected = selectedIndex === index
          const current = currentMode === mode
          return <Text key={mode} inverse={selected} color={selected ? tuiTheme.accent : tuiTheme.border}>
            {selected ? "›" : " "} {index + 1}. {labels[index]}{current ? (zh ? "（当前）" : " (current)") : ""}  <Text dimColor={!selected}>{descriptions[index]}</Text>
          </Text>
        })}
      </Box>
      <Box marginTop={1}><Text dimColor>{zh ? "↑↓ 选择 · Enter 确认 · Esc 取消" : "↑↓ Select · Enter Confirm · Esc Cancel"}</Text></Box>
    </DialogSurface></DialogManager>
  )
}
