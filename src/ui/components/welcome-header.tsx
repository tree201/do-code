import path from "node:path"
import React from "react"
import { Box, Text } from "ink"
import type { DoCodeLanguage } from "../../config.js"
import { DO_CODE_VERSION } from "../../version.js"
import { t } from "../i18n.js"
import { displayWidth, padTerminalEnd, truncateTerminal, truncateTerminalStart } from "../terminal-text.js"
import { tuiTheme } from "../theme.js"

const DO_CODE_LOGO = [
  "  ____   ___   ",
  " |  _ \\ / _ \\  ",
  " | | | | | | | ",
  " | |_| | |_| | ",
  " |____/ \\___/  ",
]

function compactPath(workspace: string, maxLength: number) {
  const home = process.env.HOME
  const display = home && (workspace === home || workspace.startsWith(`${home}${path.sep}`))
    ? `~${workspace.slice(home.length)}`
    : workspace
  if (displayWidth(display) <= maxLength) return display
  const name = path.basename(display)
  if (displayWidth(name) + 6 >= maxLength) return truncateTerminalStart(display, maxLength)
  const prefixWidth = Math.max(1, maxLength - displayWidth(name) - 5)
  return `${truncateTerminal(display, prefixWidth, "")}/…/${name}`
}

export function WelcomeHeader({ workspace, model, sessionId, restored, width, agent, language = "en" }: {
  workspace: string
  model: string
  sessionId: string
  restored: boolean
  width: number
  agent?: string
  language?: DoCodeLanguage
}) {
  const horizontalMargin = width >= 36 ? 2 : 0
  const outerWidth = Math.max(16, width - horizontalMargin)
  const showLogo = width >= 76
  const logoWidth = Math.max(...DO_CODE_LOGO.map((line) => line.length))
  const gap = 3
  const panelWidth = showLogo ? Math.min(62, outerWidth - logoWidth - gap) : outerWidth
  const contentWidth = Math.max(1, panelWidth - 4)
  const workspaceLabel = compactPath(workspace, Math.max(1, contentWidth - 11))
  const sessionLabel = truncateTerminal(sessionId, Math.max(5, contentWidth - 9))
  const modelLabel = truncateTerminal(model, Math.max(1, contentWidth - 11))
  const agentLabel = agent ? truncateTerminal(agent, Math.max(1, contentWidth - 11)) : undefined
  const label = (value: string) => padTerminalEnd(value, 11)

  return (
    <Box flexDirection="column" marginX={width >= 36 ? 1 : 0}>
      <Box alignItems="center">
        {showLogo ? (
          <Box flexDirection="column" flexShrink={0} marginRight={gap}>
            {DO_CODE_LOGO.map((line, index) => <Text key={`${index}-${line}`} bold color={tuiTheme.brand}>{line}</Text>)}
          </Box>
        ) : null}
        <Box flexDirection="column" borderStyle="round" borderColor={tuiTheme.border} paddingX={1} width={panelWidth}>
          <Text>
            <Text bold color={tuiTheme.brand}>›_ do-code</Text>
            {width >= 30 ? <Text dimColor>  v{DO_CODE_VERSION}</Text> : null}
            {restored ? <Text color={tuiTheme.success}>  {t(language, "resumed")}</Text> : null}
          </Text>
          {width >= 48 ? <Text dimColor>{t(language, "let's do it!")}</Text> : null}
          <Text>{label(t(language, "Model"))}<Text color={tuiTheme.accent}>{modelLabel}</Text></Text>
          {agentLabel ? <Text>{label(t(language, "Agent"))}<Text color={tuiTheme.accent}>{agentLabel}</Text></Text> : null}
          <Text>{label(t(language, "Workspace"))}<Text dimColor>{workspaceLabel}</Text></Text>
          <Text>{label(t(language, "Session"))}<Text dimColor>{sessionLabel}</Text></Text>
        </Box>
      </Box>
      <Box marginTop={1} marginLeft={showLogo && width >= 100 ? logoWidth + gap : 1}>
        <Text bold>{t(language, "Tip")}</Text>
        <><Text dimColor> {t(language, "Type ")}</Text><Text color={tuiTheme.accent}>/</Text><Text dimColor>{t(language, width >= 48 ? " for commands" : "help")}</Text></>
        {width >= 48 ? <><Text dimColor> · </Text><Text color={tuiTheme.accent}>@</Text><Text dimColor> {t(language, "to attach files")}</Text></> : null}
        {width >= 72 ? <><Text dimColor> · </Text><Text color={tuiTheme.accent}>Ctrl+H</Text><Text dimColor> {t(language, "for shortcuts")}</Text></> : null}
      </Box>
    </Box>
  )
}
