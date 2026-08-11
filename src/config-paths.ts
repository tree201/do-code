import os from "node:os"
import path from "node:path"
import { projectDataPath } from "./sessions.js"

const DO_CODE_CONFIG_PATH = "DO_CODE_CONFIG_PATH"
const DO_CODE_SYSTEM_CONFIG_PATH = "DO_CODE_SYSTEM_CONFIG_PATH"
const DO_CODE_MODEL_STATE_PATH = "DO_CODE_MODEL_STATE_PATH"

export function doCodeConfigPath() {
  return process.env[DO_CODE_CONFIG_PATH] ?? path.join(os.homedir(), ".config", "do-code", "config.json")
}

export function projectConfigPath(workspace: string) {
  return projectDataPath(workspace, "config.json")
}

export function projectConfigDirectory(workspace: string) {
  return projectDataPath(workspace)
}

export function systemConfigPath() {
  if (process.env[DO_CODE_SYSTEM_CONFIG_PATH]) return process.env[DO_CODE_SYSTEM_CONFIG_PATH]
  return process.platform === "darwin"
    ? "/Library/Application Support/do-code/config.json"
    : process.platform === "win32"
      ? "C:\\ProgramData\\do-code\\config.json"
      : "/etc/do-code/config.json"
}

export function doCodeModelStatePath() {
  return process.env[DO_CODE_MODEL_STATE_PATH] ?? path.join(os.homedir(), ".config", "do-code", "model.json")
}
