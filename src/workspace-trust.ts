import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

function trustFile(configDirectory = path.join(os.homedir(), ".config", "do-code")) {
  return path.join(configDirectory, "trusted-workspaces.json")
}

async function loadTrust(configDirectory?: string) {
  try {
    const parsed = JSON.parse(await readFile(trustFile(configDirectory), "utf8")) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch { return [] }
}

export async function isWorkspaceTrusted(workspace: string, configDirectory?: string) {
  const target = path.resolve(workspace)
  return (await loadTrust(configDirectory)).some((trusted) => target === trusted || target.startsWith(`${trusted}${path.sep}`))
}

export async function setWorkspaceTrusted(workspace: string, trusted: boolean, configDirectory?: string) {
  const file = trustFile(configDirectory)
  const target = path.resolve(workspace)
  const current = new Set(await loadTrust(configDirectory))
  if (trusted) current.add(target)
  else current.delete(target)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify([...current].sort(), null, 2)}\n`, "utf8")
  return trusted
}
