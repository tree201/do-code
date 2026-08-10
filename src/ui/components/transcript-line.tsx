import React from "react"
import type { DoCodeLanguage } from "../../config.js"
import type { TranscriptItem } from "../transcript-model.js"
import { WelcomeHeader } from "./welcome-header.js"
import { ToolActivityGroup } from "./tool-activity-group.js"
import { AssistantMessage, PlanTranscript, ResumeMessage, SystemNotice, UserMessage } from "./transcript-messages.js"

export function TranscriptLine({ item, width, language = "en" }: {
  item: TranscriptItem
  width: number
  language?: DoCodeLanguage
}) {
  if (item.kind === "header") return <WelcomeHeader {...item} width={width} language={language} />
  if (item.kind === "resume") return <ResumeMessage item={item} width={width} language={language} />
  if (item.kind === "user") return <UserMessage item={item} width={width} language={language} />
  if (item.kind === "assistant") return <AssistantMessage item={item} width={width} language={language} />
  if (item.kind === "plan") return <PlanTranscript item={item} width={width} language={language} />
  if (item.kind === "tool") {
    if (item.hidden) return null
    return <ToolActivityGroup tools={item.tools} phase="completed" width={width} language={language} />
  }
  return <SystemNotice item={item} width={width} language={language} />
}

export { PlanTranscript } from "./transcript-messages.js"
