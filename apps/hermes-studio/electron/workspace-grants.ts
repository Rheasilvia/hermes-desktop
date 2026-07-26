import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { nativeError } from './native-errors.js'
import { expectSessionId } from './validation.js'

export class WorkspaceGrants {
  readonly #roots = new Map<string, string>()

  set(sessionId: string, root: string): void {
    this.#roots.set(sessionId, root)
  }

  rootsForSession(sessionId: string): string[] {
    const root = this.#roots.get(sessionId)
    return root ? [root] : []
  }

  clear(): void {
    this.#roots.clear()
  }
}

export interface WorkspaceSelectionOptions {
  sessionId: unknown
  pickDirectory: () => Promise<string | undefined>
  updateSessionCwd: (sessionId: string, cwd: string) => Promise<string>
  grants: WorkspaceGrants
}

export async function selectWorkspaceForSession(options: WorkspaceSelectionOptions): Promise<string> {
  const sessionId = expectSessionId(options.sessionId)
  const selected = await options.pickDirectory()
  if (!selected) throw nativeError('WORKSPACE_SELECTION_CANCELLED', 'Workspace selection was cancelled')
  let canonical: string
  try {
    canonical = await realpath(path.resolve(selected))
    if (!(await stat(canonical)).isDirectory()) throw new Error('not a directory')
  } catch {
    throw nativeError('WORKSPACE_PATH_INVALID', 'Selected workspace is not an existing directory')
  }
  const cwd = await options.updateSessionCwd(sessionId, canonical)
  options.grants.set(sessionId, canonical)
  return cwd
}
