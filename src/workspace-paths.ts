import { realpath } from "node:fs/promises"
import path from "node:path"

export function pathIsOutsideWorkspace(workspace: string, requested: string) {
  const root = path.resolve(workspace)
  const target = path.resolve(root, requested)
  const relative = path.relative(root, target)
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

export function resolveInside(workspace: string, requested: string) {
  if (pathIsOutsideWorkspace(workspace, requested)) throw new Error(`Path escapes workspace: ${requested}`)
  return path.resolve(workspace, requested)
}

async function assertAgainstRealRoot(workspace: string, requested: string, root: string) {
  const lexical = resolveInside(workspace, requested)
  let probe = lexical
  while (probe !== path.dirname(probe)) {
    try { probe = await realpath(probe); break }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      probe = path.dirname(probe)
    }
  }
  const relative = path.relative(root, probe)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Path escapes workspace through a symbolic link: ${requested}`)
  return lexical
}

export async function assertRealPathInside(workspace: string, requested: string) {
  return await assertAgainstRealRoot(workspace, requested, await realpath(path.resolve(workspace)))
}

export async function assertRealPathsInside(workspace: string, requested: string[]) {
  const root = await realpath(path.resolve(workspace))
  for (const item of requested) await assertAgainstRealRoot(workspace, item, root)
}
