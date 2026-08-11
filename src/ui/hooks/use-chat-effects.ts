import { useEffect } from "react"
import { isWorkspaceTrusted } from "../../policy.js"
import { commandOutput } from "../command-output.js"
import type { ChatAppProps } from "../chat-app-types.js"
import type { ChatAppState } from "./use-chat-app-state.js"

export function useChatEffects(props: ChatAppProps, state: ChatAppState, stdout: NodeJS.WriteStream) {
  useEffect(() => {
    const updateSize = () => { state.setTerminalWidth(stdout.columns || 80); state.setTerminalHeight(stdout.rows || 24) }
    stdout.on("resize", updateSize)
    return () => { stdout.off("resize", updateSize) }
  }, [state.setTerminalHeight, state.setTerminalWidth, stdout])

  useEffect(() => {
    void commandOutput("rg", ["--files", "--hidden", "--glob", "!.git/**", "--glob", "!.do-code/**", "--glob", "!node_modules/**", "--glob", "!dist/**", "--glob", "!build/**", "--glob", "!coverage/**"], props.workspace)
      .then((output) => state.setWorkspaceFiles(output.split("\n").map((file) => file.trim()).filter(Boolean).slice(0, 5000)))
  }, [props.workspace, state.setWorkspaceFiles])

  useEffect(() => {
    const stats = props.conversation.stats()
    state.setContextPercent(Math.round(stats.currentContextTokens / stats.contextWindow * 100))
    void props.conversation.memorySources().then((sources) => state.setMemoryCount(sources.length))
    void isWorkspaceTrusted(props.workspace).then(state.setTrusted)
  }, [props.conversation, props.workspace, state.setContextPercent, state.setMemoryCount, state.setTrusted])

}
