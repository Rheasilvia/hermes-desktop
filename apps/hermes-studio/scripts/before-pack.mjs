import { existsSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageNodePty } from './stage-native-deps.mjs'

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARCHITECTURES = new Map([
  [0, 'ia32'],
  [1, 'x64'],
  [2, 'armv7l'],
  [3, 'arm64'],
  [4, 'universal'],
])

function configured(environment, names) {
  return names.some((name) => String(environment[name] ?? '').trim().length > 0)
}

function hasAppleNotaryCredentials(environment) {
  if (configured(environment, ['APPLE_NOTARY_PROFILE'])) return true
  return ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
    .every((name) => String(environment[name] ?? '').trim().length > 0)
}

export function archName(value) {
  const name = ARCHITECTURES.get(value)
  if (!name) throw new Error(`Unsupported electron-builder architecture: ${String(value)}`)
  return name
}

export function cleanStaleAppOutDir(appOutDir) {
  if (!appOutDir || typeof appOutDir !== 'string' || !existsSync(appOutDir)) return false
  rmSync(appOutDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  return true
}

export function validateHostNativeTarget(platform, arch, hostPlatform = process.platform, hostArch = process.arch) {
  if (arch === 'universal') {
    throw new Error('Universal packages are unsupported because the PyInstaller sidecar is host-native')
  }
  if (platform !== hostPlatform || arch !== hostArch) {
    throw new Error(
      `The host-native sidecar is ${hostPlatform}-${hostArch}; refusing target ${platform}-${arch}. ` +
      'Build on a matching native runner.',
    )
  }
}

export function packagingDisposition(platform, environment = process.env) {
  const release = String(environment.HERMES_STUDIO_RELEASE ?? '').trim() === '1'
  if (platform === 'darwin') {
    const signed = configured(environment, ['CSC_LINK', 'CSC_NAME'])
    return { channel: release && signed && hasAppleNotaryCredentials(environment) ? 'release' : 'internal', signed }
  }
  if (platform === 'win32') {
    const signed = configured(environment, ['WIN_CSC_LINK', 'CSC_LINK', 'CSC_NAME'])
    return { channel: release && signed ? 'release' : 'internal', signed }
  }
  return { channel: release ? 'release' : 'internal', signed: false }
}

export function assertHostSidecar(platform, sidecarRoot = path.join(studioRoot, 'sidecar', 'dist', 'electron')) {
  const name = platform === 'win32' ? 'daemon.exe' : 'daemon'
  const staleName = platform === 'win32' ? 'daemon' : 'daemon.exe'
  const executable = path.join(sidecarRoot, name)
  if (!existsSync(executable)) throw new Error(`Host-native sidecar is missing: ${executable}`)
  if (existsSync(path.join(sidecarRoot, staleName))) {
    throw new Error(`Stale foreign sidecar is present: ${path.join(sidecarRoot, staleName)}`)
  }
  if (platform !== 'win32' && (statSync(executable).mode & 0o111) === 0) {
    throw new Error(`Host-native sidecar is not executable: ${executable}`)
  }
  return executable
}

export default async function beforePack(context) {
  const platform = context?.electronPlatformName
  const arch = archName(context?.arch)
  if (!platform) throw new Error('electron-builder did not provide a target platform')
  validateHostNativeTarget(platform, arch)
  assertHostSidecar(platform)
  cleanStaleAppOutDir(context?.appOutDir)

  const disposition = packagingDisposition(platform)
  if (process.env.HERMES_STUDIO_RELEASE === '1' && disposition.channel !== 'release') {
    throw new Error(`A public ${platform} release requires configured signing${platform === 'darwin' ? ' and notarization' : ''}`)
  }

  await stageNodePty({ platform, arch })
  console.log(`[before-pack] staged host-native payloads for ${platform}-${arch} (${disposition.channel})`)
}
