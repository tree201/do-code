import { spawn } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { SandboxNetworkMode, StoredConfig } from "./config.js"
import type { ToolResult } from "./tools.js"
import type { ShellSpawnSpec } from "./background-processes.js"

// Adapted from the strict allow-list design used by Gemini CLI and the
// canonical-path handling used by Qwen Code (both Apache-2.0 projects).
const SEATBELT_BASE = `(version 1)
(deny default)
(import "system.sb")

(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info*)
(allow pseudo-tty)

(allow file-map-executable
  (subpath "/System/Library/Frameworks")
  (subpath "/System/Library/PrivateFrameworks")
  (subpath "/usr/lib")
  (subpath "/bin")
  (subpath "/usr/bin"))

(allow file-read*
  (subpath "/System")
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/usr/bin")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/Library")
  (subpath "/private/etc")
  (subpath "/private/var/db")
  (subpath "/private/var/run"))

(allow file-read* file-write*
  (literal "/dev/null")
  (literal "/dev/zero")
  (literal "/dev/tty")
  (subpath "/dev/fd")
  (subpath "/tmp")
  (subpath "/private/tmp"))

(allow file-read-metadata
  (literal "/")
  (subpath "/var")
  (subpath "/private/var")
  (subpath "/dev"))

(allow sysctl-read)
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.system.opendirectoryd.membership")
  (global-name "com.apple.system.logger")
  (global-name "com.apple.logd")
  (global-name "com.apple.secinitd")
  (global-name "com.apple.trustd.agent")
  (global-name "com.apple.trustd"))
`

const LOCAL_NETWORK_PROFILE = `(allow network-inbound (local ip "localhost:*"))
(allow network-bind (local ip "localhost:*"))`

const FULL_NETWORK_PROFILE = `(allow network-outbound)
(allow network-inbound)
(allow network-bind)
(allow mach-lookup
  (global-name "com.apple.bsd.dirhelper")
  (global-name "com.apple.networkd")
  (global-name "com.apple.ocspd")
  (global-name "com.apple.mDNSResponder")
  (global-name "com.apple.SystemConfiguration.DNSConfiguration")
  (global-name "com.apple.SystemConfiguration.configd"))`

function schemeString(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`
}

function canonical(value: string) {
  try { return realpathSync(value) } catch { return path.resolve(value) }
}

function uniqueCanonicalPaths(values: string[]) {
  return [...new Set(values.filter(Boolean).flatMap((value) => {
    const resolved = path.resolve(value)
    const real = canonical(resolved)
    return resolved === real ? [resolved] : [resolved, real]
  }))]
}

const NETWORK_LEVEL: Record<SandboxNetworkMode, number> = { none: 0, local: 1, full: 2 }

function effectiveNetworkMode(configured: SandboxNetworkMode | undefined, requested: SandboxNetworkMode) {
  const maximum = configured ?? "full"
  return NETWORK_LEVEL[requested] <= NETWORK_LEVEL[maximum] ? requested : maximum
}

function seatbeltProfile(workspace: string, network: SandboxNetworkMode) {
  const roots = uniqueCanonicalPaths([workspace])
  const temporary = uniqueCanonicalPaths([os.tmpdir()])
  const executableRoots = uniqueCanonicalPaths([
    path.dirname(path.dirname(process.execPath)),
    ...(process.env.PATH ?? "").split(path.delimiter).filter((entry) => entry && existsSync(entry)).map((entry) => path.basename(entry) === "bin" ? path.dirname(entry) : entry),
  ])
  const rules = [SEATBELT_BASE]
  for (const root of executableRoots) rules.push(`(allow file-read* (subpath ${schemeString(root)}))`)
  for (const root of temporary) rules.push(`(allow file-read* file-write* (subpath ${schemeString(root)}))`)
  for (const root of roots) {
    rules.push(`(allow file-read* file-write* (subpath ${schemeString(root)}))`)
    rules.push(`(deny file-write* (subpath ${schemeString(path.join(root, ".git"))}))`)
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("/", "\\/")
    rules.push(`(deny file-read* file-write* (regex #"^${escaped}\/(.\/)?\\.env(\\..+)?$"))`)
  }
  if (network === "local") rules.push(LOCAL_NETWORK_PROFILE)
  if (network === "full") rules.push(FULL_NETWORK_PROFILE)
  return rules.join("\n")
}

export function createSandboxShellSpawnSpec(workspace: string, sandbox: StoredConfig["sandbox"] = {}, command: string, requestedNetwork: SandboxNetworkMode = "none"): ShellSpawnSpec {
  const type = sandbox?.type ?? (process.platform === "darwin" ? "seatbelt" : "local")
  const network = effectiveNetworkMode(sandbox?.network, requestedNetwork)
  const cwd = canonical(workspace)
  if (type === "container") return {
    executable: "docker",
    args: ["run", "--rm", "-i", ...(network === "full" ? [] : ["--network", "none"]), "-v", `${cwd}:/workspace`, "-w", "/workspace", sandbox?.image ?? "node:22-alpine", "sh", "-c", command],
    cwd,
    env: process.env,
  }
  if (type === "seatbelt" && process.platform === "darwin") return {
    executable: "/usr/bin/sandbox-exec",
    args: ["-p", seatbeltProfile(workspace, network), process.env.SHELL ?? "/bin/sh", "-c", command],
    cwd,
    env: process.env,
  }
  return { executable: process.env.SHELL ?? "/bin/sh", args: ["-c", command], cwd, env: process.env }
}

export function createSandboxShellRunner(workspace: string, sandbox: StoredConfig["sandbox"] = {}) {
  return async (command: string, timeoutMs: number, onOutput?: (chunk: string) => void, signal?: AbortSignal, requestedNetwork: SandboxNetworkMode = "none"): Promise<ToolResult> => {
    const spec = createSandboxShellSpawnSpec(workspace, sandbox, command, requestedNetwork)
    return await new Promise((resolve) => {
      const child = spawn(spec.executable, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ["ignore", "pipe", "pipe"], ...(signal ? { signal } : {}) })
      let output = ""
      let settled = false
      const finish = (result: ToolResult) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result) }
      const timer = setTimeout(() => { child.kill("SIGTERM"); finish({ ok: false, output: `Command timed out after ${timeoutMs}ms` }) }, timeoutMs)
      const append = (chunk: Buffer) => { const value = chunk.toString(); output += value; onOutput?.(value) }
      child.stdout.on("data", append)
      child.stderr.on("data", append)
      child.on("error", (error) => finish({ ok: false, output: error.message }))
      child.on("close", (code) => finish({ ok: code === 0, output: output.trim() || `Command exited with code ${code}` }))
    })
  }
}
