import fs from 'node:fs'
import path from 'node:path'
import type { PtySpawner } from './terminal-manager.js'

export interface SpawnHelperFs {
  existsSync(candidate: string): boolean
  readdirSync(candidate: string): string[]
  statSync(candidate: string): { mode: number }
  chmodSync(candidate: string, mode: number): void
}

export interface SpawnHelperRepairResult {
  fixed: string[]
}

export function writableNodePtyRoot(nodePtyRoot: string): string {
  return nodePtyRoot.replace(/app\.asar(?=\/|\\|$)/, 'app.asar.unpacked')
}

export function ensureSpawnHelperExecutable(
  nodePtyRoot: string,
  filesystem: SpawnHelperFs = fs,
): SpawnHelperRepairResult {
  const root = writableNodePtyRoot(nodePtyRoot)
  const candidates: string[] = []
  const prebuilds = path.join(root, 'prebuilds')
  if (filesystem.existsSync(prebuilds)) {
    for (const directory of filesystem.readdirSync(prebuilds)) {
      candidates.push(path.join(prebuilds, directory, 'spawn-helper'))
    }
  }
  candidates.push(path.join(root, 'build', 'Release', 'spawn-helper'))
  const fixed: string[] = []
  for (const candidate of candidates) {
    try {
      if (!filesystem.existsSync(candidate)) continue
      const mode = filesystem.statSync(candidate).mode
      if ((mode & 0o111) === 0o111) continue
      filesystem.chmodSync(candidate, mode | 0o111)
      fixed.push(candidate)
    } catch {
      // Best effort: node-pty will surface the real spawn failure if repair was impossible.
    }
  }
  return { fixed }
}

export function createEnsuredPtySpawner(
  spawn: PtySpawner,
  options: {
    platform?: NodeJS.Platform
    nodePtyRoot: string
    ensure?: (nodePtyRoot: string) => unknown
  },
): PtySpawner {
  let checked = false
  return (file, args, spawnOptions) => {
    if (!checked && (options.platform ?? process.platform) !== 'win32') {
      checked = true
      try { (options.ensure ?? ensureSpawnHelperExecutable)(options.nodePtyRoot) } catch { /* best effort */ }
    }
    return spawn(file, args, spawnOptions)
  }
}
