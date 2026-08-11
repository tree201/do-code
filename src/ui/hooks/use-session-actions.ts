import { useCallback } from "react"
import { restoredSessionItems } from "../session-transcript.js"
import { t } from "../i18n.js"
import type { ChatAppProps } from "../chat-app-types.js"
import type { ChatAppState } from "./use-chat-app-state.js"
import type { TranscriptController } from "./use-transcript-controller.js"

export function useSessionActions(props: ChatAppProps, state: ChatAppState, transcript: TranscriptController) {
  const resumeSelectedSession = useCallback((id: string) => {
    state.setActiveDialog({ kind: "none" })
    state.updateRunning(true)
    void (async () => {
      try {
        const loaded = await state.runtimeStore.resumeSession(id)
        state.appendMany(restoredSessionItems(loaded.session.title ?? loaded.session.id, loaded.messages, loaded.events, state.activeLanguage))
      } catch (error) {
        transcript.appendReportedError(t(state.activeLanguage, "Resume failed"), error, "session.resume", { id })
      } finally {
        state.updateRunning(false)
      }
    })()
  }, [state.activeLanguage, state.appendMany, state.runtimeStore, state.setActiveDialog, state.updateRunning, transcript.appendReportedError])

  const openSessionPicker = useCallback((query = "") => {
    void props.listSessions().then((sessions) => {
      if (!sessions.length) {
        state.append({ kind: "info", text: t(state.activeLanguage, "This project has no resumable sessions.") })
        return
      }
      state.setActiveDialog({ kind: "session-picker", items: sessions, query, selectedIndex: 0 })
    }).catch((error) => transcript.appendReportedError(t(state.activeLanguage, "Failed to list sessions"), error, "session.list"))
  }, [props.listSessions, state.append, state.setActiveDialog, transcript.appendReportedError])

  return { resumeSelectedSession, openSessionPicker }
}

export type SessionActions = ReturnType<typeof useSessionActions>
