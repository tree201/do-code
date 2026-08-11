import React from "react"
import { Box, Static } from "ink"
import { showInteractiveComposer, showRunningActivity } from "../dialog-coordinator.js"
import { DefaultAppLayout } from "../layouts/default-app-layout.js"
import { TranscriptLine } from "./transcript-line.js"
import { TranscriptViewer } from "./transcript-viewer.js"
import { ChatComposer } from "./chat-composer.js"
import { ChatDialogs } from "./chat-dialogs.js"
import { QueuedMessages, RunningActivity } from "./chat-activity.js"
import { TranscriptBlock } from "./transcript-block.js"
import { ToolActivityGroup } from "./tool-activity-group.js"
import { transcriptBoundary, visibleTranscriptItem } from "../transcript-layout.js"
import type { ChatAppProps } from "../chat-app-types.js"
import type { ChatAppState } from "../hooks/use-chat-app-state.js"

export function ChatAppView({ props, state }: { props: ChatAppProps; state: ChatAppState }) {
  const staticItems = state.viewerItems ?? state.items
  const previousStaticItem = [...staticItems].reverse().find(visibleTranscriptItem)
  const pendingTool = state.pendingToolGroup?.tools.length ? state.pendingToolGroup : undefined
  return <DefaultAppLayout
    width={state.terminalWidth}
      main={<>
       <Static key={`transcript-${props.renderRevision ?? 0}`} items={staticItems}>{(item, index) => {
         if (!visibleTranscriptItem(item)) return null
         const previous = [...staticItems.slice(0, index)].reverse().find(visibleTranscriptItem)
         const boundary = transcriptBoundary(previous, item)
         return <TranscriptBlock key={item.id} boundary={boundary} width={state.terminalWidth}><TranscriptLine item={item} width={state.terminalWidth} language={state.activeLanguage} /></TranscriptBlock>
        }}</Static>
        {!state.viewerItems && pendingTool ? <TranscriptBlock first={!previousStaticItem} width={state.terminalWidth}><ToolActivityGroup tools={pendingTool.tools} phase="pending" width={state.terminalWidth} language={state.activeLanguage} /></TranscriptBlock> : null}
     </>}
     controls={<Box flexDirection="column">
       {state.viewerItems ? <TranscriptViewer items={state.viewerItems} offset={state.effectiveViewerOffset} width={state.terminalWidth} height={state.viewerHeight} language={state.activeLanguage} preparedLines={state.viewerLines} /> : null}
       <ChatDialogs props={props} state={state} />
          {!state.viewerItems && state.running && state.liveAssistant && showRunningActivity(state.activeDialog) ? <TranscriptBlock boundary={pendingTool || previousStaticItem?.kind === "tool" ? "divider" : previousStaticItem?.kind === "assistant" && previousStaticItem.streamGroup !== undefined ? "none" : "space"} first={!pendingTool && !previousStaticItem} width={state.terminalWidth}><RunningActivity liveAssistant={state.liveAssistant} width={state.terminalWidth} height={state.terminalHeight} activityEpoch={state.activityEpoch} activeTool={state.activeTool} reasoningCharacters={state.reasoningCharacters} language={state.activeLanguage} /></TranscriptBlock> : null}
       {!state.viewerItems && showInteractiveComposer(state.activeDialog) ? <QueuedMessages messages={state.queuedInputs} language={state.activeLanguage} /> : null}
      <ChatComposer props={props} state={state} />
    </Box>}
  />
}
