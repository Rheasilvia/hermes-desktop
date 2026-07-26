import { rebuild } from '@electron/rebuild'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const studioRoot = path.resolve(scriptDirectory, '..')
const manifest = JSON.parse(readFileSync(path.join(studioRoot, 'package.json'), 'utf8'))

export async function rebuildNodePty({ arch = process.arch } = {}) {
  await rebuild({
    buildPath: studioRoot,
    electronVersion: manifest.build.electronVersion,
    arch,
    onlyModules: ['node-pty'],
    force: true,
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await rebuildNodePty({ arch: process.argv[2] || process.arch })
}
