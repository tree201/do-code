import type { ToolImplementation } from "./tool-contracts.js"
import { toolSchema } from "./tool-definition-helpers.js"
import { text } from "./tool-input.js"
import { applyToolGitPatch, toolPatchPaths } from "./tool-patch.js"
import { assertRealPathsInside } from "./workspace-paths.js"
import { TOOL_NAMES } from "./tool-names.js"

export const patchTools = [{
  definition: { type: "function", function: {
    name: TOOL_NAMES.APPLY_PATCH,
    description: "Apply one unified Git patch that may update multiple files inside the workspace.",
    parameters: toolSchema({ patch: { type: "string" } }, ["patch"]),
  } },
  async execute(args, context) {
    const patchText = text(args, "patch")
    const paths = toolPatchPaths(patchText)
    if (!paths.length) return { ok: false, output: "Patch does not contain file headers" }
    await assertRealPathsInside(context.workspace, paths)
    for (const requested of paths) await context.beforeFileWrite?.(TOOL_NAMES.APPLY_PATCH, requested)
    return await applyToolGitPatch(context.workspace, patchText, context.signal)
  },
}] satisfies ToolImplementation[]
