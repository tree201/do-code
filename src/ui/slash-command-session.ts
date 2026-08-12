import { matchSessionQuery, parseExportArguments, parseRewindMode } from "./session-actions.js"
import { t } from "./i18n.js"
import type { SlashCommandContext } from "./slash-command-context.js"
import { COMPACT_COMMAND, EXPORT_COMMAND, MEMORY_COMMAND, RENAME_COMMAND, RESUME_COMMAND, REWIND_COMMAND, STATS_COMMAND, commandArgument, commandWithArgument } from "./shortcut-command-policy.js"

export function executeSessionSlashCommand(input: string, context: SlashCommandContext) {
  const { props, state, transcript, sessions } = context
  if (input === STATS_COMMAND) {
    const stats = props.conversation.stats()
    const percent = Math.round(stats.currentContextTokens / stats.contextWindow * 100)
    state.setContextPercent(percent)
    state.append({ kind: "info", text: t(state.activeLanguage, "Model requests: {requests}\nInput tokens: {inputTokens}\nOutput tokens: {outputTokens}\nCached tokens: {cachedTokens}\nTool calls: {toolCalls}\nContext compactions: {compactions}\nCurrent context: about {currentContextTokens} / {contextWindow} tokens ({percent}%)", { ...stats, percent }) })
    return true
  }
  if (input === COMPACT_COMMAND) {
    state.updateRunning(true); state.setActiveTool(t(state.activeLanguage, "Compacting context"))
    void props.conversation.compact().then((compacted) => { const stats = props.conversation.stats(); state.setContextPercent(Math.round(stats.currentContextTokens / stats.contextWindow * 100)); state.append({ kind: "info", text: compacted ? t(state.activeLanguage, "Context compacted to about {tokens} tokens.", { tokens: stats.currentContextTokens }) : t(state.activeLanguage, "The current context does not need compaction.") }) }).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Compaction failed"), error, "context.compact")).finally(() => { state.updateRunning(false); state.setActiveTool(null) })
    return true
  }
  if (commandWithArgument(input, REWIND_COMMAND)) {
    const requested = commandArgument(input, REWIND_COMMAND) || "both"
    const mode = parseRewindMode(requested)
    if (!mode) state.append({ kind: "error", text: t(state.activeLanguage, "Usage: /rewind [both|chat|files]") })
    else void props.conversation.rewind(mode).then((checkpoint) => state.append({ kind: "info", text: t(state.activeLanguage, "Rewound to {id} ({mode}): {path}", { id: checkpoint.id, mode, path: checkpoint.path }) })).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Rewind failed"), error, "checkpoint.rewind", { requested: mode }))
    return true
  }
  const memoryArgument = commandArgument(input, MEMORY_COMMAND)
  const isMemoryCommand = input === MEMORY_COMMAND
    || memoryArgument === "list"
    || memoryArgument === "reload"
    || memoryArgument === "show"
    || memoryArgument.startsWith("show ")
  if (isMemoryCommand) {
    state.updateRunning(true); state.setActiveTool(t(state.activeLanguage, "Project instructions"))
    void (async () => {
      try {
        const sources = memoryArgument === "reload" ? await props.conversation.reloadMemory() : await props.conversation.memorySources()
        state.setMemoryCount(sources.length)
        if (memoryArgument === "reload") state.append({ kind: "info", text: t(state.activeLanguage, "Project instructions reloaded from {sources} source(s).", { sources: sources.length }) })
        else if (memoryArgument === "show" || memoryArgument.startsWith("show ")) {
          const query = memoryArgument.slice("show".length).trim()
          const selected = query ? sources.filter((source, index) => String(index + 1) === query || source.path.includes(query)) : sources
          state.append({ kind: "info", text: selected.length ? selected.map((source) => `# ${source.label}\n${source.path}\n\n${source.content}`).join("\n\n---\n\n") : t(state.activeLanguage, "Instruction source not found: {query}", { query: query || t(state.activeLanguage, "current project") }) })
        } else state.append({ kind: "info", text: sources.length ? `${t(state.activeLanguage, "Using {sources} AGENTS.md file(s):", { sources: sources.length })}\n${sources.map((source, index) => `${index + 1}. [${source.scope}] ${source.path}`).join("\n")}` : t(state.activeLanguage, "No AGENTS.md files are loaded.") })
      } catch (error) { transcript.appendReportedError(t(state.activeLanguage, "Project instruction operation failed"), error, "memory.command", { input }) }
      finally { state.updateRunning(false); state.setActiveTool(null) }
    })()
    return true
  }
  if (input === RESUME_COMMAND) { sessions.openSessionPicker(); return true }
  if (commandWithArgument(input, RESUME_COMMAND)) {
    const query = commandArgument(input, RESUME_COMMAND)
    void props.listSessions().then((allSessions) => {
      const matches = matchSessionQuery(allSessions, query)
      if (matches.length === 1) sessions.resumeSelectedSession(matches[0]!.id)
      else if (matches.length > 1) state.setActiveDialog({ kind: "session-picker", items: matches, query: "", selectedIndex: 0 })
      else state.append({ kind: "error", text: t(state.activeLanguage, "Session not found: {query}", { query }) })
    }).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Failed to search sessions"), error, "session.search", { query }))
    return true
  }
  if (commandWithArgument(input, RENAME_COMMAND)) {
    const title = commandArgument(input, RENAME_COMMAND)
    if (!title) state.append({ kind: "error", text: t(state.activeLanguage, "Usage: /rename <new-name>") })
    else { state.updateRunning(true); state.setActiveTool(t(state.activeLanguage, "Renaming session")); void state.runtimeStore.renameSession(title).then((session) => state.append({ kind: "info", text: t(state.activeLanguage, "Session renamed to: {title}", { title: session.title ?? session.id }) })).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Rename failed"), error, "session.rename", { title })).finally(() => { state.updateRunning(false); state.setActiveTool(null) }) }
    return true
  }
  if (commandWithArgument(input, EXPORT_COMMAND)) {
    const args = parseExportArguments(commandArgument(input, EXPORT_COMMAND))
    if (!args) state.append({ kind: "error", text: t(state.activeLanguage, "Usage: /export [md|json] [output-path]") })
    else { state.updateRunning(true); state.setActiveTool(t(state.activeLanguage, "Exporting session")); void props.exportCurrentSession(args.format, args.output).then((file) => state.append({ kind: "info", text: t(state.activeLanguage, "Session exported: {file}", { file }) })).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Export failed"), error, "session.export", args)).finally(() => { state.updateRunning(false); state.setActiveTool(null) }) }
    return true
  }
  return false
}
