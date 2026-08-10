import { spawn } from "node:child_process"

const checks = ["check-file-size.js", "check-hardcoded-values.js"]
let failed = false
for (const script of checks) {
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [`scripts/${script}`], { stdio: "inherit" })
    child.on("close", (code) => resolve(code ?? 1))
  })
  if (result !== 0) failed = true
}
if (failed) process.exitCode = 1
