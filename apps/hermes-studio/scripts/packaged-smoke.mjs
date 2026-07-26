#!/usr/bin/env node
import assert from 'node:assert/strict'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SUPPORTED_PLATFORMS = new Set(['darwin', 'win32', 'linux'])
const SUPPORTED_ARCHITECTURES = new Set(['x64', 'arm64'])

export function createPackagedSmokeLaunchEnvironment(baseEnvironment, hermesHome, userData) {
  return {
    ...baseEnvironment,
    HERMES_HOME: hermesHome,
    HERMES_STUDIO_INTERNAL_PACKAGED_SMOKE: '1',
    HERMES_STUDIO_INTERNAL_PACKAGED_SMOKE_USER_DATA: userData,
  }
}

function directories(root, depth = 0) {
  if (!existsSync(root) || depth > 3) return []
  const result = [root]
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    result.push(...directories(path.join(root, entry.name), depth + 1))
  }
  return result
}

function executableCandidates(directory, platform) {
  return executableNames(platform).map((name) => path.join(directory, name)).filter(existsSync)
}

function executableNames(platform) {
  return platform === 'win32'
    ? ['Hermes Studio.exe']
    : ['hermes-studio', 'Hermes Studio']
}

function readBytes(file, length, offset = 0) {
  const descriptor = openSync(file, 'r')
  try {
    const bytes = Buffer.alloc(length)
    const count = readSync(descriptor, bytes, 0, length, offset)
    return bytes.subarray(0, count)
  } finally {
    closeSync(descriptor)
  }
}

function architectureForMachCpu(value) {
  const cpu = value >>> 0
  if (cpu === 0x01000007) return 'x64'
  if (cpu === 0x0100000c) return 'arm64'
  if (cpu === 7) return 'ia32'
  if (cpu === 12) return 'armv7l'
  return undefined
}

function architectureForPeMachine(value) {
  if (value === 0x8664) return 'x64'
  if (value === 0xaa64) return 'arm64'
  if (value === 0x014c) return 'ia32'
  if (value === 0x01c4) return 'armv7l'
  return undefined
}

function architectureForElfMachine(value) {
  if (value === 62) return 'x64'
  if (value === 183) return 'arm64'
  if (value === 3) return 'ia32'
  if (value === 40) return 'armv7l'
  return undefined
}

function uniqueArchitectures(values) {
  return [...new Set(values.filter(Boolean))].sort()
}

/** Read just the executable headers needed to identify platform and CPU ABI. */
export function inspectNativeBinary(file) {
  let prefix
  try {
    prefix = readBytes(file, 64)
  } catch {
    return null
  }
  if (prefix.length < 20) return null

  if (prefix[0] === 0x4d && prefix[1] === 0x5a && prefix.length >= 64) {
    const peOffset = prefix.readUInt32LE(0x3c)
    if (peOffset > 16 * 1024 * 1024) return null
    const pe = readBytes(file, 6, peOffset)
    if (pe.length < 6 || pe.subarray(0, 4).toString('hex') !== '50450000') return null
    const architecture = architectureForPeMachine(pe.readUInt16LE(4))
    return architecture ? { platform: 'win32', architectures: [architecture] } : null
  }

  if (prefix.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    const littleEndian = prefix[5] === 1
    const bigEndian = prefix[5] === 2
    if (!littleEndian && !bigEndian) return null
    const machine = littleEndian ? prefix.readUInt16LE(18) : prefix.readUInt16BE(18)
    const architecture = architectureForElfMachine(machine)
    return architecture ? { platform: 'linux', architectures: [architecture] } : null
  }

  const magic = prefix.subarray(0, 4).toString('hex')
  const thinMach = new Map([
    ['cffaedfe', 'le'],
    ['cefaedfe', 'le'],
    ['feedfacf', 'be'],
    ['feedface', 'be'],
  ])
  const byteOrder = thinMach.get(magic)
  if (byteOrder) {
    const cpu = byteOrder === 'le' ? prefix.readUInt32LE(4) : prefix.readUInt32BE(4)
    const architecture = architectureForMachCpu(cpu)
    return architecture ? { platform: 'darwin', architectures: [architecture] } : null
  }

  const fatMach = new Map([
    ['cafebabe', { byteOrder: 'be', entrySize: 20 }],
    ['bebafeca', { byteOrder: 'le', entrySize: 20 }],
    ['cafebabf', { byteOrder: 'be', entrySize: 32 }],
    ['bfbafeca', { byteOrder: 'le', entrySize: 32 }],
  ])
  const fat = fatMach.get(magic)
  if (!fat) return null
  const readUInt32 = fat.byteOrder === 'le'
    ? (bytes, offset) => bytes.readUInt32LE(offset)
    : (bytes, offset) => bytes.readUInt32BE(offset)
  const count = readUInt32(prefix, 4)
  if (count < 1 || count > 32) return null
  const table = readBytes(file, 8 + count * fat.entrySize)
  if (table.length < 8 + count * fat.entrySize) return null
  const architectures = []
  for (let index = 0; index < count; index += 1) {
    architectures.push(architectureForMachCpu(readUInt32(table, 8 + index * fat.entrySize)))
  }
  const unique = uniqueArchitectures(architectures)
  return unique.length > 0 ? { platform: 'darwin', architectures: unique } : null
}

export function assertNativeBinaryTarget(file, platform, arch) {
  const inspected = inspectNativeBinary(file)
  if (!inspected) throw new Error(`Native binary format is not recognized: ${file}`)
  if (inspected.platform !== platform || inspected.architectures.length !== 1 || inspected.architectures[0] !== arch) {
    throw new Error(
      `Native binary target mismatch for ${file}: expected ${platform}-${arch}, ` +
      `found ${inspected.platform}-${inspected.architectures.join('+')}`,
    )
  }
  return inspected
}

function macBundleForExecutable(executable) {
  let current = path.dirname(executable)
  while (current !== path.dirname(current)) {
    if (current.endsWith('.app')) return current
    current = path.dirname(current)
  }
  return undefined
}

export function resolvePackagedApplication(rawAppPath, platform = process.platform, arch = process.arch) {
  if (!SUPPORTED_PLATFORMS.has(platform)) throw new Error(`Unsupported packaged platform: ${platform}`)
  if (!SUPPORTED_ARCHITECTURES.has(arch)) throw new Error(`Unsupported packaged architecture: ${arch}`)
  const requestedTarget = path.resolve(rawAppPath)
  if (!existsSync(requestedTarget)) throw new Error(`Packaged application path does not exist: ${requestedTarget}`)
  const target = realpathSync(requestedTarget)
  const metadata = lstatSync(target)

  if (platform === 'darwin') {
    const appPath = metadata.isDirectory() && target.endsWith('.app')
      ? target
      : metadata.isFile()
        ? macBundleForExecutable(target)
        : undefined
    if (!appPath) throw new Error(`macOS --app-path must be a .app bundle or its executable: ${target}`)
    const executablePath = path.join(appPath, 'Contents', 'MacOS', 'Hermes Studio')
    const resourcesPath = path.join(appPath, 'Contents', 'Resources')
    if (!existsSync(executablePath) || !existsSync(resourcesPath)) {
      throw new Error(`Hermes Studio macOS bundle is incomplete: ${appPath}`)
    }
    return { appPath, executablePath, resourcesPath, platform, arch }
  }

  if (metadata.isFile() && !executableNames(platform).includes(path.basename(target))) {
    throw new Error(`--app-path does not name the Hermes Studio executable: ${requestedTarget}`)
  }
  const appPath = metadata.isFile() ? path.dirname(target) : target
  const executablePath = metadata.isFile() ? target : executableCandidates(appPath, platform)[0]
  const resourcesPath = path.join(appPath, 'resources')
  if (!executablePath || !existsSync(resourcesPath)) {
    throw new Error(`Hermes Studio installation directory is incomplete: ${appPath}`)
  }
  return { appPath, executablePath, resourcesPath, platform, arch }
}

function applicationMatchesTarget(application, platform, arch) {
  try {
    assertNativeBinaryTarget(application.executablePath, platform, arch)
    return true
  } catch {
    return false
  }
}

function expectedUnpackedApplication(releaseRoot, platform, arch) {
  if (platform === 'darwin') {
    const directory = arch === 'x64' ? 'mac' : `mac-${arch}`
    return path.join(releaseRoot, directory, 'Hermes Studio.app')
  }
  const prefix = platform === 'win32' ? 'win' : 'linux'
  const directory = arch === 'x64' ? `${prefix}-unpacked` : `${prefix}-${arch}-unpacked`
  return path.join(releaseRoot, directory)
}

export function findPackagedApplication(releaseRoot, platform = process.platform, arch = process.arch) {
  const expected = expectedUnpackedApplication(releaseRoot, platform, arch)
  if (existsSync(expected)) {
    const application = resolvePackagedApplication(expected, platform, arch)
    if (applicationMatchesTarget(application, platform, arch)) return application
  }

  const candidates = []
  const seen = new Set()
  for (const directory of directories(releaseRoot)) {
    try {
      let candidate
      if (platform === 'darwin' && directory.endsWith('.app')) {
        candidate = resolvePackagedApplication(directory, platform, arch)
      } else if (platform !== 'darwin' && existsSync(path.join(directory, 'resources', 'app.asar'))) {
        candidate = resolvePackagedApplication(directory, platform, arch)
      }
      if (!candidate || seen.has(candidate.appPath)) continue
      seen.add(candidate.appPath)
      if (applicationMatchesTarget(candidate, platform, arch)) candidates.push(candidate)
    } catch {
      // Ignore incomplete and foreign candidates. A precise failure follows.
    }
  }
  candidates.sort((left, right) => left.appPath.localeCompare(right.appPath))
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) {
    throw new Error(
      `Multiple ${platform}-${arch} Hermes Studio applications were found; pass --app-path explicitly:\n` +
      candidates.map((candidate) => `  ${candidate.appPath}`).join('\n'),
    )
  }
  throw new Error(`Could not find a ${platform}-${arch} unpacked Hermes Studio application under ${releaseRoot}`)
}

function filesNamed(root, predicate) {
  const result = []
  function visit(directory) {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(candidate)
      else if (entry.isFile() && predicate(entry.name)) result.push(candidate)
    }
  }
  visit(root)
  return result.sort()
}

export function validatePackagedLayout(application, platform = application.platform ?? process.platform, arch = application.arch ?? process.arch) {
  const sidecar = path.join(application.resourcesPath, 'sidecar', platform === 'win32' ? 'daemon.exe' : 'daemon')
  const nodePty = path.join(
    application.resourcesPath,
    'app.asar.unpacked',
    'dist',
    'node_modules',
    'node-pty',
  )
  for (const required of [
    application.executablePath,
    path.join(application.resourcesPath, 'app.asar'),
    sidecar,
    path.join(nodePty, 'package.json'),
    path.join(nodePty, 'lib', 'index.js'),
  ]) {
    if (!existsSync(required)) throw new Error(`Packaged file is missing: ${required}`)
  }

  const nodeModules = filesNamed(nodePty, (name) => name.endsWith('.node'))
  if (nodeModules.length === 0) throw new Error(`Packaged node-pty has no native binary for ${platform}-${arch}`)
  const nativePayloads = new Set([application.executablePath, sidecar, ...nodeModules])
  for (const executable of filesNamed(nodePty, (name) => /\.exe$/i.test(name) || /\.dll$/i.test(name))) {
    nativePayloads.add(executable)
  }

  if (platform !== 'win32') {
    if ((statSync(sidecar).mode & 0o111) === 0) throw new Error('Packaged sidecar is not executable')
    const helpers = filesNamed(nodePty, (name) => name === 'spawn-helper')
    if (helpers.length === 0 || helpers.some((helper) => (statSync(helper).mode & 0o111) === 0)) {
      throw new Error('Packaged node-pty spawn-helper is missing or not executable')
    }
    for (const helper of helpers) nativePayloads.add(helper)
  }

  for (const nativePayload of nativePayloads) assertNativeBinaryTarget(nativePayload, platform, arch)
  return { sidecar, nodePty, nativePayloads: [...nativePayloads].sort() }
}

async function retry(operation, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`${description} timed out: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function assertHealth(info) {
  const response = await fetch(`${info.baseUrl}/desktop/api/health`, {
    headers: { Authorization: `Bearer ${info.token}` },
  })
  assert.equal(response.ok, true, `sidecar health returned HTTP ${response.status}`)
}

async function assertHealthStops(info) {
  await retry(async () => {
    try {
      const response = await fetch(`${info.baseUrl}/desktop/api/health`, {
        headers: { Authorization: `Bearer ${info.token}` },
        signal: AbortSignal.timeout(500),
      })
      if (response.ok) throw new Error('sidecar still responds')
    } catch (error) {
      if (error instanceof Error && error.message === 'sidecar still responds') throw error
      return true
    }
    throw new Error('sidecar still responds')
  }, 15_000, 'owned sidecar cleanup')
}

async function waitForRenderer(page) {
  await retry(async () => {
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 })
    const ready = await page.evaluate(() => Boolean(window.hermesStudio))
    if (!ready) throw new Error('preload bridge is unavailable')
  }, 30_000, 'packaged renderer')
}

async function waitForBackend(page) {
  return retry(
    () => page.evaluate(() => window.hermesStudio.backend.info()),
    90_000,
    'backend bridge',
  )
}

export async function smokePackagedApplication(application) {
  const { _electron } = await import('playwright')
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-packaged-smoke-'))
  const hermesHome = path.join(temporary, '.hermes')
  const userData = path.join(temporary, 'electron-user-data')
  const assetPath = path.join(hermesHome, 'smoke', 'opaque.gif')
  mkdirSync(userData, { mode: 0o700 })
  mkdirSync(path.dirname(assetPath), { recursive: true })
  writeFileSync(assetPath, Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'))
  let electronApp
  let activeInfo
  try {
    electronApp = await _electron.launch({
      executablePath: application.executablePath,
      env: createPackagedSmokeLaunchEnvironment(process.env, hermesHome, userData),
      timeout: 120_000,
    })
    const page = await electronApp.firstWindow({ timeout: 120_000 })
    await waitForRenderer(page)
    activeInfo = await waitForBackend(page)
    // The initial READY event updates the CSP's exact loopback origin and
    // schedules one renderer reload. Let that navigation finish before a
    // long, stateful bridge evaluation begins.
    await new Promise((resolve) => setTimeout(resolve, 500))
    await waitForRenderer(page)
    activeInfo = await waitForBackend(page)
    await assertHealth(activeInfo)

    const bridgeResult = await page.evaluate(async ({ backend, imagePath }) => {
      const bridge = window.hermesStudio
      const nativeState = await bridge.app.nativeState()
      const platform = await bridge.app.platform()
      const version = await bridge.app.version()
      const nodeGlobalsAbsent = ['require', 'module', 'Buffer', 'process']
        .every((name) => typeof globalThis[name] === 'undefined')
      const bridgeFrozen = Object.isFrozen(bridge)
        && Object.values(bridge).every((section) => Object.isFrozen(section))
        && Object.values(bridge).flatMap((section) => Object.values(section)).every((member) => Object.isFrozen(member))

      const textPath = 'smoke/bridge.txt'
      const text = `Hermes Studio bridge ${Date.now()}`
      await bridge.hermesHome.writeText(textPath, text)
      const textRead = await bridge.hermesHome.readText(textPath)
      const listed = await bridge.hermesHome.list('smoke')

      const assetUrl = await bridge.assets.urlForPath(imagePath)
      const assetLoaded = await new Promise((resolve, reject) => {
        const image = new Image()
        const timer = setTimeout(() => reject(new Error('opaque asset load timed out')), 10_000)
        image.onload = () => {
          clearTimeout(timer)
          resolve(image.naturalWidth === 1 && image.naturalHeight === 1)
        }
        image.onerror = () => {
          clearTimeout(timer)
          reject(new Error('opaque asset failed to load'))
        }
        image.src = assetUrl
      })

      const api = async (pathname, init = {}) => {
        const headers = new Headers(init.headers)
        headers.set('Authorization', `Bearer ${backend.token}`)
        if (init.body !== undefined) headers.set('Content-Type', 'application/json')
        const response = await fetch(`${backend.baseUrl}${pathname}`, { ...init, headers })
        if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${pathname} returned HTTP ${response.status}`)
        return response.status === 204 ? undefined : response.json()
      }
      const created = await api('/desktop/api/sessions', { method: 'POST', body: '{}' })
      const sessionId = created.session_id ?? created.id
      if (typeof sessionId !== 'string' || !sessionId) throw new Error('session creation returned no id')
      let sessionCrud = false
      let sse = false
      try {
        const sessions = await api('/desktop/api/sessions')
        if (!Array.isArray(sessions) || !sessions.some((session) => session.id === sessionId)) {
          throw new Error('created session was not returned by list')
        }
        sessionCrud = true
        sse = await new Promise((resolve, reject) => {
          const source = new EventSource(`${backend.baseUrl}/desktop/api/events/stream?token=${encodeURIComponent(backend.token)}`)
          const timer = setTimeout(() => {
            source.close()
            reject(new Error('SSE connection timed out'))
          }, 15_000)
          source.onopen = () => {
            clearTimeout(timer)
            source.close()
            resolve(true)
          }
          source.onerror = () => {
            clearTimeout(timer)
            source.close()
            reject(new Error('SSE connection failed'))
          }
        })
      } finally {
        await api(`/desktop/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
      }

      let notification
      try {
        const shown = await bridge.notifications.show({
          title: 'Hermes Studio package check',
          body: 'Native notification bridge is available.',
        })
        notification = { status: 'shown', id: shown.id }
      } catch (error) {
        if (error && error.code === 'NOTIFICATIONS_UNAVAILABLE') {
          notification = { status: 'unavailable', code: error.code }
        } else {
          throw error
        }
      }

      const sentinel = `HERMES_STUDIO_PTY_${Date.now()}`
      let terminalId = ''
      let output = ''
      let finish
      let fail
      const observed = new Promise((resolve, reject) => { finish = resolve; fail = reject })
      const unsubscribeData = bridge.terminal.onData((event) => {
        if (event.id !== terminalId) return
        output += new TextDecoder().decode(new Uint8Array(event.data))
        if (output.includes(sentinel)) finish()
      })
      const unsubscribeExit = bridge.terminal.onExit((event) => {
        if (event.id === terminalId) fail(new Error(`PTY exited before sentinel (${event.code})`))
      })
      const unsubscribeError = bridge.terminal.onError((event) => {
        if (event.id === terminalId) fail(new Error(event.error))
      })
      try {
        const terminal = await bridge.terminal.start({ cwd: null, cols: 80, rows: 24 })
        terminalId = terminal.id
        const shell = terminal.shell.toLowerCase()
        const command = shell.includes('powershell') || shell.includes('pwsh')
          ? `Write-Output '${sentinel}'\r\n`
          : shell.endsWith('cmd.exe') || shell.endsWith('cmd')
            ? `echo ${sentinel}\r\n`
            : `printf '${sentinel}\\n'\n`
        await bridge.terminal.resize(terminal.id, 100, 30)
        await bridge.terminal.write(terminal.id, Array.from(new TextEncoder().encode(command)))
        await Promise.race([
          observed,
          new Promise((_, reject) => setTimeout(() => reject(new Error('PTY sentinel timed out')), 30_000)),
        ])
        await bridge.terminal.stop(terminal.id)
      } finally {
        unsubscribeData()
        unsubscribeExit()
        unsubscribeError()
      }
      return {
        nativeState,
        platform,
        version,
        nodeGlobalsAbsent,
        bridgeFrozen,
        hermesHome: textRead === text && listed.includes('bridge.txt'),
        asset: /^hermes-studio-asset:\/\/asset\/[A-Za-z0-9_-]{32,}$/.test(assetUrl) && assetLoaded,
        sessionCrud,
        sse,
        notification,
        pty: output.includes(sentinel),
      }
    }, { backend: activeInfo, imagePath: assetPath })

    assert.equal(bridgeResult.nativeState.isPackaged, true)
    assert.equal(bridgeResult.nodeGlobalsAbsent, true)
    assert.equal(bridgeResult.bridgeFrozen, true)
    assert.equal(bridgeResult.hermesHome, true)
    assert.equal(bridgeResult.asset, true)
    assert.equal(bridgeResult.sessionCrud, true)
    assert.equal(bridgeResult.sse, true)
    assert.match(bridgeResult.notification.status, /^(shown|unavailable)$/)
    assert.equal(bridgeResult.pty, true)

    const previousInfo = activeInfo
    const reloaded = page.waitForEvent('domcontentloaded', { timeout: 120_000 })
    await page.evaluate(() => {
      sessionStorage.setItem('hermes-studio-packaged-restart', 'pending')
      void window.hermesStudio.backend.restart()
    })
    await reloaded
    await waitForRenderer(page)
    assert.equal(await page.evaluate(() => sessionStorage.getItem('hermes-studio-packaged-restart')), 'pending')
    activeInfo = await waitForBackend(page)
    await assertHealth(activeInfo)
    if (activeInfo.baseUrl !== previousInfo.baseUrl) await assertHealthStops(previousInfo)

    await electronApp.close()
    electronApp = undefined
    await assertHealthStops(activeInfo)
    return {
      protocol: true,
      renderer: true,
      nativeState: true,
      bridgeIsolation: true,
      hermesHome: true,
      asset: true,
      sessionRest: true,
      sse: true,
      notification: bridgeResult.notification.status,
      sidecar: true,
      restart: true,
      pty: true,
      cleanup: true,
    }
  } finally {
    if (electronApp) await electronApp.close().catch(() => {})
    rmSync(temporary, { recursive: true, force: true })
  }
}

export function parseSmokeArguments(argv) {
  let appPath
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--app-path') {
      if (appPath !== undefined) throw new Error('--app-path may be provided only once')
      appPath = argv[index + 1]
      index += 1
      if (!appPath) throw new Error('--app-path requires an absolute path')
      continue
    }
    if (argument.startsWith('--app-path=')) {
      if (appPath !== undefined) throw new Error('--app-path may be provided only once')
      appPath = argument.slice('--app-path='.length)
      if (!appPath) throw new Error('--app-path requires an absolute path')
      continue
    }
    throw new Error(`Unknown packaged smoke argument: ${argument}`)
  }
  if (appPath !== undefined && !path.isAbsolute(appPath)) throw new Error('--app-path must be absolute')
  return { appPath }
}

async function main() {
  const { appPath } = parseSmokeArguments(process.argv.slice(2))
  const releaseRoot = path.join(studioRoot, 'release')
  const application = appPath
    ? resolvePackagedApplication(appPath)
    : findPackagedApplication(releaseRoot)
  validatePackagedLayout(application)
  const internalMarker = path.join(application.resourcesPath, 'INTERNAL-BUILD.txt')
  if (process.env.HERMES_STUDIO_RELEASE !== '1' && !existsSync(internalMarker)) {
    throw new Error('Unsigned/local package is missing its INTERNAL-BUILD marker')
  }
  const result = await smokePackagedApplication(application)
  console.log(`Packaged smoke passed: ${Object.keys(result).join(', ')}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  })
}
