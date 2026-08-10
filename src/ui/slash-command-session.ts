import { matchSessionQuery, parseExportArguments, parseRewindMode } from "./session-actions.js"
import type { SlashCommandContext } from "./slash-command-context.js"
import { COMPACT_COMMAND, EXPORT_COMMAND, MEMORY_COMMAND, RENAME_COMMAND, RESTORE_COMMAND, RESUME_COMMAND, REWIND_COMMAND, STATS_COMMAND, commandArgument, commandWithArgument } from "./shortcut-command-policy.js"

export function executeSessionSlashCommand(input: string, context: SlashCommandContext) {
  const { props, state, transcript, sessions } = context
  if (commandWithArgument(input, RESTORE_COMMAND)) {
    const id = commandArgument(input, RESTORE_COMMAND) || undefined
    void props.conversation.restoreCheckpoint(id).then((checkpoint) => state.append({ kind: "info", text: `Restored file checkpoint ${checkpoint.id}: ${checkpoint.path}` })).catch((error) => transcript.appendReportedError("Restore failed", error, "checkpoint.restore", { id }))
    return true
  }
  if (input === STATS_COMMAND) {
    const stats = props.conversation.stats()
    const percent = Math.round(stats.currentContextTokens / stats.contextWindow * 100)
    state.setContextPercent(percent)
    state.append({ kind: "info", text: `Model requests: ${stats.requests}\nInput tokens: ${stats.inputTokens}\nOutput tokens: ${stats.outputTokens}\nCached tokens: ${stats.cachedTokens}\nTool calls: ${stats.toolCalls}\nContext compactions: ${stats.compactions}\nCurrent context: about ${stats.currentContextTokens} / ${stats.contextWindow} tokens (${percent}%)` })
    return true
  }
  if (input === COMPACT_COMMAND) {
    state.updateRunning(true); state.setActiveTool("Compacting context")
    void props.conversation.compact().then((compacted) => { const stats = props.conversation.stats(); state.setContextPercent(Math.round(stats.currentContextTokens / stats.contextWindow * 100)); state.append({ kind: "info", text: compacted ? `Context compacted to about ${stats.currentContextTokens} tokens.` : "The current context does not need compaction." }) }).catch((error) => transcript.appendReportedError("Compaction failed", error, "context.compact")).finally(() => { state.updateRunning(false); state.setActiveTool(null) })
    return true
  }
  if (commandWithArgument(input, REWIND_COMMAND)) {
    const requested = commandArgument(input, REWIND_COMMAND) || "both"
    const mode = parseRewindMode(requested)
    if (!mode) state.append({ kind: "error", text: "Usage: /rewind [both|chat|files]" })
    else void props.conversation.rewind(mode).then((checkpoint) => state.append({ kind: "info", text: `Rewound to ${checkpoint.id} (${mode}): ${checkpoint.path}` })).catch((error) => transcript.appendReportedError("Rewind failed", error, "checkpoint.rewind", { requested: mode }))
    return true
  }
  const memoryArgument = commandArgument(input, MEMORY_COMMAND)
  const isMemoryCommand = input === MEMORY_COMMAND
    || memoryArgument === "list"
    || memoryArgument === "reload"
    || memoryArgument === "show"
    || memoryArgument.startsWith("show ")
  if (isMemoryCommand) {
    state.updateRunning(true); state.setActiveTool("Project instructions")
    void (async () => {
      try {
        const sources = memoryArgument === "reload" ? await props.conversation.reloadMemory() : await props.conversation.memorySources()
        state.setMemoryCount(sources.length)
        if (memoryArgument === "reload") state.append({ kind: "info", text: `Project instructions reloaded from ${sources.length} source(s).` })
        else if (memoryArgument === "show" || memoryArgument.startsWith("show ")) {
          const query = memoryArgument.slice("show".length).trim()
          const selected = query ? sources.filter((source, index) => String(index + 1) === query || source.path.includes(query)) : sources
          state.append({ kind: "info", text: selected.length ? selected.map((source) => `# ${source.label}\n${source.path}\n\n${source.content}`).join("\n\n---\n\n") : `Instruction source not found: ${query || "current project"}` })
        } else state.append({ kind: "info", text: sources.length ? `Using ${sources.length} AGENTS.md file(s):\n${sources.map((source, index) => `${index + 1}. [${source.scope}] ${source.path}`).join("\n")}` : "No AGENTS.md files are loaded." })
      } catch (error) { transcript.appendReportedError("Project instruction operation failed", error, "memory.command", { input }) }
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
      else state.append({ kind: "error", text: `Session not found: ${query}` })
    }).catch((error) => transcript.appendReportedError("Failed to search sessions", error, "session.search", { query }))
    return true
  }
  if (commandWithArgument(input, RENAME_COMMAND)) {
    const title = commandArgument(input, RENAME_COMMAND)
    if (!title) state.append({ kind: "error", text: "Usage: /rename <new-name>" })
    else { state.updateRunning(true); state.setActiveTool("Renaming session"); void state.runtimeStore.renameSession(title).then((session) => state.append({ kind: "info", text: `Session renamed to: ${session.title}` })).catch((error) => transcript.appendReportedError("Rename failed", error, "session.rename", { title })).finally(() => { state.updateRunning(false); state.setActiveTool(null) }) }
    return true
  }
  if (commandWithArgument(input, EXPORT_COMMAND)) {
    const args = parseExportArguments(commandArgument(input, EXPORT_COMMAND))
    if (!args) state.append({ kind: "error", text: "Usage: /export [md|json] [output-path]" })
    else { state.updateRunning(true); state.setActiveTool("Exporting session"); void props.exportCurrentSession(args.format, args.output).then((file) => state.append({ kind: "info", text: `Session exported: ${file}` })).catch((error) => transcript.appendReportedError("Export failed", error, "session.export", args)).finally(() => { state.updateRunning(false); state.setActiveTool(null) }) }
    return true
  }
  return false
}
