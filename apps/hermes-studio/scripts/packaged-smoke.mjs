#!/usr/bin/env node
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
  const names = platform === 'win32'
    ? ['Hermes Studio.exe']
    : ['hermes-studio', 'Hermes Studio']
  return names.map((name) => path.join(directory, name)).filter(existsSync)
}

export function findPackagedApplication(releaseRoot, platform = process.platform, arch = process.arch) {
  for (const directory of directories(releaseRoot)) {
    if (platform === 'darwin' && directory.endsWith('.app')) {
      const executablePath = path.join(directory, 'Contents', 'MacOS', 'Hermes Studio')
      const resourcesPath = path.join(directory, 'Contents', 'Resources')
      if (existsSync(executablePath) && existsSync(resourcesPath)) {
        return { appPath: directory, executablePath, resourcesPath, platform, arch }
      }
    }
    if (platform !== 'darwin') {
      const resourcesPath = path.join(directory, 'resources')
      const executablePath = executableCandidates(directory, platform)[0]
      if (executablePath && existsSync(path.join(resourcesPath, 'app.asar'))) {
        return { appPath: directory, executablePath, resourcesPath, platform, arch }
      }
    }
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
  return result
}

export function validatePackagedLayout(application, platform = process.platform, arch = process.arch) {
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
  if (filesNamed(nodePty, (name) => name.endsWith('.node')).length === 0) {
    throw new Error(`Packaged node-pty has no native binary for ${platform}-${arch}`)
  }
  if (platform !== 'win32') {
    if ((statSync(sidecar).mode & 0o111) === 0) throw new Error('Packaged sidecar is not executable')
    const helpers = filesNamed(nodePty, (name) => name === 'spawn-helper')
    if (helpers.length === 0 || helpers.some((helper) => (statSync(helper).mode & 0o111) === 0)) {
      throw new Error('Packaged node-pty spawn-helper is missing or not executable')
    }
  }
  return { sidecar, nodePty }
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

export async function smokePackagedApplication(application) {
  const { _electron } = await import('playwright')
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-packaged-smoke-'))
  let electronApp
  let info
  try {
    electronApp = await _electron.launch({
      executablePath: application.executablePath,
      env: {
        ...process.env,
        HERMES_HOME: path.join(temporary, '.hermes'),
      },
      timeout: 120_000,
    })
    const page = await electronApp.firstWindow({ timeout: 120_000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => Boolean(window.hermesStudio), undefined, { timeout: 30_000 })
    assert.match(page.url(), /^hermes-studio:\/\/app\//)
    assert.equal(await page.locator('#root').count(), 1)

    const bridgeResult = await page.evaluate(async () => {
      const bridge = window.hermesStudio
      const nativeState = await bridge.app.nativeState()
      const platform = await bridge.app.platform()
      const deadline = Date.now() + 90_000
      let backend
      while (!backend && Date.now() < deadline) {
        try { backend = await bridge.backend.info() } catch { await new Promise((resolve) => setTimeout(resolve, 100)) }
      }
      if (!backend) throw new Error('backend bridge did not become ready')

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
      return { nativeState, platform, backend, pty: output.includes(sentinel) }
    })

    assert.equal(bridgeResult.nativeState.isPackaged, true)
    assert.equal(bridgeResult.pty, true)
    info = bridgeResult.backend
    await assertHealth(info)
    await electronApp.close()
    electronApp = undefined
    await assertHealthStops(info)
    return { protocol: true, renderer: true, nativeState: true, sidecar: true, pty: true, cleanup: true }
  } finally {
    if (electronApp) await electronApp.close().catch(() => {})
    rmSync(temporary, { recursive: true, force: true })
  }
}

async function main() {
  const releaseRoot = path.join(studioRoot, 'release')
  const application = findPackagedApplication(releaseRoot)
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
