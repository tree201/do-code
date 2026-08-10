import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"
import { tuiTheme } from "../theme.js"

export function QuestionDialog({ question, options, selectedIndex, draft, language }: {
  question: string
  options: string[]
  selectedIndex: number
  draft: string
  language: DoCodeLanguage
}) {
  const hasOptions = options.length > 0
  return (
    <DialogManager><DialogSurface>
      <Text bold>{language === "zh" ? "需要你的输入" : "Agent needs your input"}</Text>
      <Box marginTop={1}><Text wrap="wrap">{question}</Text></Box>
      <Box flexDirection="column" marginTop={1} paddingLeft={1}>
        {hasOptions
          ? options.map((option, index) => (
            <Text key={`${index}-${option}`} wrap="wrap" inverse={selectedIndex === index}>
              {selectedIndex === index ? "›" : " "} {option}
            </Text>
          ))
          : <Text><Text color={tuiTheme.accent}>› </Text>{draft}<Text inverse> </Text></Text>}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{hasOptions
          ? language === "zh" ? "↑↓ 选择 · Enter 确认 · Esc 取消" : "↑↓ Select · Enter Answer · Esc Cancel"
          : language === "zh" ? "输入回答 · Enter 发送 · Esc 取消" : "Type an answer · Enter Send · Esc Cancel"}</Text>
      </Box>
    </DialogSurface></DialogManager>
  )
}
