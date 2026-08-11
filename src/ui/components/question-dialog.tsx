import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import { t } from "../i18n.js"
import { DialogManager, DialogSurface } from "./dialog-manager.js"
import { tuiTheme } from "../theme.js"

export function QuestionDialog({ question, options, selectedIndex, draft, customAnswer, language }: {
  question: string
  options: string[]
  selectedIndex: number
  draft: string
  customAnswer: boolean
  language: DoCodeLanguage
}) {
  return (
    <DialogManager><DialogSurface>
      <Text bold>{t(language, "Agent needs your input")}</Text>
      <Box marginTop={1}><Text wrap="wrap">{question}</Text></Box>
      <Box flexDirection="column" marginTop={1} paddingLeft={1}>
        {customAnswer
          ? <Text><Text color={tuiTheme.accent}>› </Text>{draft}<Text inverse> </Text></Text>
          : options.map((option, index) => (
            <Text key={`${index}-${option}`} wrap="wrap" inverse={selectedIndex === index}>
              {selectedIndex === index ? "›" : " "} {option}
            </Text>
          ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{t(language, customAnswer ? "Type an answer · Enter Send · Esc Back" : "↑↓ Select · Enter Answer · Esc Cancel")}</Text>
      </Box>
    </DialogSurface></DialogManager>
  )
}
