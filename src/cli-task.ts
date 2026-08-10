import { readFile } from "node:fs/promises"
import path from "node:path"
import type { Args } from "./cli-args.js"

export type HeadlessTask = {
  task: string
  pipedTask: string
  imageReferences: string[]
}

export function imageTaskReferences(workspace: string, images: string[] = []) {
  return images.map((image) => {
    const absolute = path.resolve(workspace, image)
    const relative = path.relative(workspace, absolute)
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Image must be inside the workspace: ${image}`)
    }
    return `@${relative}`
  })
}

export function composeHeadlessTask(pipedTask: string, explicitTask: string, imageReferences: string[]) {
  const text = [pipedTask.trim(), explicitTask.trim()].filter(Boolean).join("\n\n")
  const task = [text, imageReferences.join(" ")].filter(Boolean).join("\n")
  if (!task) throw new Error("Task must not be empty")
  return task
}

export async function resolveHeadlessTask(args: Args, pipedTask: string): Promise<HeadlessTask> {
  const explicitTask = args.taskFile ? (await readFile(args.taskFile, "utf8")).trim() : (args.task ?? "").trim()
  const imageReferences = imageTaskReferences(args.workspace, args.images)
  return { task: composeHeadlessTask(pipedTask, explicitTask, imageReferences), pipedTask, imageReferences }
}
