import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { PermissionRule } from "./policy-contracts.js"

export function userPermissionFile(configDirectory = path.join(os.homedir(), ".config", "do-code")) {
  return path.join(configDirectory, "permissions.json")
}

export function systemPermissionFile() {
  if (process.platform === "darwin") return "/Library/Application Support/do-code/permissions.json"
  if (process.platform === "win32") return "C:\\ProgramData\\do-code\\permissions.json"
  return "/etc/do-code/permissions.json"
}

export async function readPermissionRules(file: string, source: NonNullable<PermissionRule["source"]>): Promise<PermissionRule[]> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { rules?: unknown[] }
    if (!Array.isArray(parsed.rules)) return []
    return parsed.rules.flatMap((value, index) => {
      if (!value || typeof value !== "object") return []
      const raw = value as Record<string, unknown>
      if (raw.decision !== "allow" && raw.decision !== "ask" && raw.decision !== "deny") return []
      if (source === "project" && raw.decision !== "deny") return []
      return [{
        id: typeof raw.id === "string" ? raw.id : `${source}.${index}`,
        decision: raw.decision,
        source,
        ...(typeof raw.tool === "string" ? { tool: raw.tool } : {}),
        ...(typeof raw.pathGlob === "string" ? { pathGlob: raw.pathGlob } : {}),
        ...(typeof raw.commandPrefix === "string" ? { commandPrefix: raw.commandPrefix } : {}),
        ...(typeof raw.commandExact === "string" ? { commandExact: raw.commandExact } : {}),
        ...(typeof raw.commandPattern === "string" ? { commandPattern: raw.commandPattern } : {}),
        ...(typeof raw.priority === "number" ? { priority: raw.priority } : {}),
      }]
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "EACCES") return []
    throw error
  }
}
