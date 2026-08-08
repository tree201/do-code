import { chmodSync, existsSync } from "node:fs"
import path from "node:path"

// Some npm/macOS combinations lose the executable bit from node-pty's helper.
// Restoring it is required before the native addon can launch a PTY process.
for (const architecture of ["darwin-x64", "darwin-arm64"]) {
  const helper = path.resolve("node_modules", "node-pty", "prebuilds", architecture, "spawn-helper")
  if (existsSync(helper)) chmodSync(helper, 0o755)
}
