import { spawn } from "node:child_process"
import type { HookEvent, SandboxNetworkMode, StoredConfig } from "./config.js"
import type { PolicyEngine } from "./policy.js"
import type { ShellSpawnSpec } from "./background-processes.js"

export type HookResult = { event: HookEvent; command: string; ok: boolean; output: string }

export class HookRunner {
  constructor(private readonly workspace: string, private readonly hooks: StoredConfig["hooks"] = {}, private readonly timeoutMs = 10_000, private readonly policy?: PolicyEngine, private readonly spawnSpec?: (command: string, network?: SandboxNetworkMode) => ShellSpawnSpec) {}

  async fire(event: HookEvent, payload: unknown): Promise<HookResult[]> {
    const results: HookResult[] = []
    for (const command of this.hooks?.[event] ?? []) results.push(await this.run(event, command, payload))
    return results
  }

  async context(event: HookEvent, payload: unknown) {
    return (await this.fire(event, payload)).filter((result) => result.ok && result.output.trim()).map((result) => result.output.trim()).join("\n")
  }

  private async run(event: HookEvent, command: string, payload: unknown): Promise<HookResult> {
    const evaluation = this.policy?.evaluate(`hook__${event}`, { command })
    if (evaluation && evaluation.decision !== "allow") return { event, command, ok: false, output: `Permission ${evaluation.decision}: ${evaluation.reason}` }
    return await new Promise((resolve) => {
      const spec = this.spawnSpec?.(command, "none") ?? { executable: process.env.SHELL ?? "/bin/sh", args: ["-c", command], cwd: this.workspace, env: process.env }
      const child = spawn(spec.executable, spec.args, {
        cwd: spec.cwd,
        env: { ...spec.env, DO_CODE_HOOK_EVENT: event, DO_CODE_WORKSPACE: this.workspace },
        stdio: ["pipe", "pipe", "pipe"],
      })
      let output = ""
      const timer = setTimeout(() => child.kill("SIGTERM"), this.timeoutMs)
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
      child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })
      child.on("error", (error) => { clearTimeout(timer); resolve({ event, command, ok: false, output: error.message }) })
      child.on("close", (code) => { clearTimeout(timer); resolve({ event, command, ok: code === 0, output: output.trim() }) })
      child.stdin.end(`${JSON.stringify(payload)}\n`)
    })
  }
}
