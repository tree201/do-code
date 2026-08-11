import { readFile } from "node:fs/promises"
import path from "node:path"
import { CliArgumentError, type Args } from "./cli-args.js"
import type { DoCodeLanguage } from "./config.js"
import { t } from "./ui/i18n.js"

export type HeadlessTask = {
  task: string
  pipedTask: string
  imageReferences: string[]
}

export function imageTaskReferences(workspace: string, images: string[] = [], language: DoCodeLanguage = "en") {
  return images.map((image) => {
    const absolute = path.resolve(workspace, image)
    const relative = path.relative(workspace, absolute)
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new CliArgumentError(t(language, "Image must be inside the workspace: {image}", { image }))
    }
    return `@${relative}`
  })
}

export function composeHeadlessTask(pipedTask: string, explicitTask: string, imageReferences: string[], language: DoCodeLanguage = "en") {
  const text = [pipedTask.trim(), explicitTask.trim()].filter(Boolean).join("\n\n")
  const task = [text, imageReferences.join(" ")].filter(Boolean).join("\n")
  if (!task) throw new CliArgumentError(t(language, "Task must not be empty"))
  return task
}

export async function resolveHeadlessTask(args: Args, pipedTask: string, language: DoCodeLanguage = args.language ?? "en"): Promise<HeadlessTask> {
  const explicitTask = args.taskFile ? (await readFile(args.taskFile, "utf8")).trim() : (args.task ?? "").trim()
  const imageReferences = imageTaskReferences(args.workspace, args.images, language)
  return { task: composeHeadlessTask(pipedTask, explicitTask, imageReferences, language), pipedTask, imageReferences }
}
