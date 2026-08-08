import { spawn } from "node:child_process"
import { DO_CODE_VERSION } from "./version.js"

export type UpdateChannel = "stable" | "preview"

function numericVersion(value: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.replace(/^v/, ""))
  return match ? { parts: match.slice(1, 4).map(Number), prerelease: match[4] ?? "" } : null
}

export function compareVersions(left: string, right: string) {
  const a = numericVersion(left), b = numericVersion(right)
  if (!a || !b) return left.localeCompare(right)
  for (let index = 0; index < 3; index++) if (a.parts[index] !== b.parts[index]) return a.parts[index]! - b.parts[index]!
  if (!a.prerelease && b.prerelease) return 1
  if (a.prerelease && !b.prerelease) return -1
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true })
}

export async function checkForUpdate(channel: UpdateChannel, fetcher: typeof fetch = fetch) {
  const registry = (process.env.DO_CODE_UPDATE_REGISTRY ?? "https://registry.npmjs.org").replace(/\/$/, "")
  const packageName = process.env.DO_CODE_UPDATE_PACKAGE ?? "do-code"
  const response = await fetcher(`${registry}/${encodeURIComponent(packageName).replace(/%40/g, "@").replace(/%2F/gi, "%2f")}`, { headers: { accept: "application/json" } })
  if (!response.ok) throw new Error(`Update registry returned HTTP ${response.status}`)
  const metadata = await response.json() as { "dist-tags"?: Record<string, string> }
  const tag = channel === "preview" ? "next" : "latest"
  const latest = metadata["dist-tags"]?.[tag]
  if (!latest) throw new Error(`Update channel ${channel} does not have an npm ${tag} release`)
  return { packageName, channel, tag, current: DO_CODE_VERSION, latest, updateAvailable: compareVersions(latest, DO_CODE_VERSION) > 0 }
}

export async function installUpdate(channel: UpdateChannel) {
  const result = await checkForUpdate(channel)
  if (!result.updateAvailable) return { ...result, installed: false }
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["install", "--global", `${result.packageName}@${result.tag}`], { stdio: "inherit", env: process.env })
    child.on("error", reject)
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`npm install exited with code ${code}`)))
  })
  return { ...result, installed: true }
}
