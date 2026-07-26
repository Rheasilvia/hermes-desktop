#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const studioRoot = path.resolve(scriptDirectory, '..')
const require = createRequire(import.meta.url)

function executable(file) {
  chmodSync(file, 0o755)
}

function copyRuntimeJavaScript(source, destination) {
  if (!existsSync(source)) return
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    if (entry.isDirectory()) copyRuntimeJavaScript(sourcePath, destinationPath)
    else if (entry.isFile() && entry.name.endsWith('.js')) cpSync(sourcePath, destinationPath)
  }
}

function copyNativeDirectory(source, destination) {
  if (!existsSync(source)) return
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      cpSync(sourcePath, destinationPath, { recursive: true })
      continue
    }
    if (!entry.isFile()) continue
    if (entry.name === 'spawn-helper' || /\.(?:node|dll|exe)$/.test(entry.name)) {
      cpSync(sourcePath, destinationPath)
      if (entry.name === 'spawn-helper') executable(destinationPath)
    }
  }
}

function patchUnixTerminalAsarPaths(destination) {
  const file = path.join(destination, 'lib', 'unixTerminal.js')
  if (!existsSync(file)) return
  const source = readFileSync(file, 'utf8')
  const patched = source
    .replaceAll(
      "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');",
      "helperPath = helperPath.replace(/app\\.asar(?!\\.unpacked)/, 'app.asar.unpacked');",
    )
    .replaceAll(
      "helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');",
      "helperPath = helperPath.replace(/node_modules\\.asar(?!\\.unpacked)/, 'node_modules.asar.unpacked');",
    )
  if (patched !== source) writeFileSync(file, patched)
}

function nativeFiles(root) {
  const files = []
  function visit(directory) {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(candidate)
      else if (entry.isFile() && entry.name.endsWith('.node')) files.push(candidate)
    }
  }
  visit(root)
  return files
}

export function classifyNativeBinary(file) {
  let descriptor
  try {
    descriptor = openSync(file, 'r')
    const bytes = Buffer.alloc(4)
    if (readSync(descriptor, bytes, 0, bytes.length, 0) < 4) return null
    if (bytes.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'linux'
    if (bytes[0] === 0x4d && bytes[1] === 0x5a) return 'win32'
    const magic = bytes.toString('hex')
    if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(magic)) {
      return 'darwin'
    }
    return null
  } catch {
    return null
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function validateNativeFiles(destination, platform) {
  const mismatches = nativeFiles(destination)
    .map((file) => ({ file, actual: classifyNativeBinary(file) }))
    .filter(({ actual }) => actual !== platform)
  if (mismatches.length === 0) return
  throw new Error(
    `node-pty native binary platform mismatch for ${platform}:\n` +
    mismatches.map(({ file, actual }) => `  ${path.relative(destination, file)}: ${actual ?? 'unknown'}`).join('\n'),
  )
}

export async function stageNodePtyInto(source, destination, options = {}) {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const hostPlatform = options.hostPlatform ?? process.platform
  const hostArch = options.hostArch ?? process.arch
  const exactHost = platform === hostPlatform && arch === hostArch

  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  cpSync(path.join(source, 'package.json'), path.join(destination, 'package.json'))
  copyRuntimeJavaScript(path.join(source, 'lib'), path.join(destination, 'lib'))
  patchUnixTerminalAsarPaths(destination)

  const sourcePrebuild = path.join(source, 'prebuilds', `${platform}-${arch}`)
  const destinationPrebuild = path.join(destination, 'prebuilds', `${platform}-${arch}`)
  copyNativeDirectory(sourcePrebuild, destinationPrebuild)

  if (nativeFiles(destinationPrebuild).length === 0) {
    if (!exactHost) {
      throw new Error(
        `No node-pty prebuild exists for ${platform}-${arch}; cannot cross-compile from ${hostPlatform}-${hostArch}`,
      )
    }
    const rebuild = options.rebuild ?? (async (rebuildOptions) => {
      const nativeRebuild = await import('./rebuild-native.mjs')
      await nativeRebuild.rebuildNodePty(rebuildOptions)
    })
    await rebuild({ arch })
    copyNativeDirectory(path.join(source, 'build', 'Release'), path.join(destination, 'build', 'Release'))
  }

  if (nativeFiles(destination).length === 0) {
    throw new Error(`node-pty staging produced no native binary for ${platform}-${arch}`)
  }
  validateNativeFiles(destination, platform)
  return destination
}

export function resolveNodePtyRoot() {
  return path.dirname(require.resolve('node-pty/package.json', { paths: [studioRoot] }))
}

export async function stageNodePty(options = {}) {
  return stageNodePtyInto(
    resolveNodePtyRoot(),
    path.join(studioRoot, 'dist', 'node_modules', 'node-pty'),
    options,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [platform, arch] = process.argv.slice(2)
  const staged = await stageNodePty({
    platform: platform || process.platform,
    arch: arch || process.arch,
  })
  console.log(`[stage-native-deps] staged ${staged}`)
}
