import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const outputDirectory = resolve(appRoot, 'dist', 'electron')

mkdirSync(outputDirectory, { recursive: true })

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  external: ['electron', 'node-pty'],
  logLevel: 'info',
}

await Promise.all([
  build({
    ...common,
    entryPoints: [resolve(appRoot, 'electron', 'main.ts')],
    format: 'esm',
    outfile: resolve(outputDirectory, 'main.mjs'),
  }),
  build({
    ...common,
    entryPoints: [resolve(appRoot, 'electron', 'preload.ts')],
    format: 'cjs',
    outfile: resolve(outputDirectory, 'preload.cjs'),
  }),
])
