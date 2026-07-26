import { execFile } from 'node:child_process'
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { packagingDisposition } from './before-pack.mjs'

export function redactCommandFailure(message, secrets = []) {
  let redacted = String(message ?? '')
  for (const secret of secrets) {
    if (secret) redacted = redacted.replaceAll(String(secret), '[REDACTED]')
  }
  return redacted.replace(
    /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g,
    '[REDACTED]',
  )
}

function run(command, args, secrets = []) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (!error) {
        resolve({ stdout, stderr })
        return
      }
      const detail = redactCommandFailure(String(stderr || stdout || error.message).trim(), secrets)
      reject(new Error(`${command} failed: ${detail}`))
    })
  })
}

function inlineApiKey(value) {
  return value.includes('BEGIN PRIVATE KEY') && value.includes('END PRIVATE KEY')
}

export function resolveAppleApiKey(rawValue) {
  const value = String(rawValue ?? '').trim()
  if (!value) return { path: '', cleanup: () => {} }
  if (existsSync(value)) return { path: value, cleanup: () => {} }
  if (!inlineApiKey(value)) throw new Error('APPLE_API_KEY must be a .p8 path or inline private-key content')
  const temporary = path.join(os.tmpdir(), `hermes-studio-notary-${process.pid}-${Date.now()}.p8`)
  writeFileSync(temporary, value, { encoding: 'utf8', mode: 0o600 })
  return { path: temporary, cleanup: () => rmSync(temporary, { force: true }) }
}

export function appleNotaryCredentials(environment = process.env) {
  const profile = String(environment.APPLE_NOTARY_PROFILE ?? '').trim()
  if (profile) return { kind: 'profile', profile }
  const key = String(environment.APPLE_API_KEY ?? '').trim()
  const keyId = String(environment.APPLE_API_KEY_ID ?? '').trim()
  const issuer = String(environment.APPLE_API_ISSUER ?? '').trim()
  if (!key && !keyId && !issuer) return null
  if (!key || !keyId || !issuer) {
    throw new Error('All three Apple API notarization values are required: APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER')
  }
  return { kind: 'api-key', key, keyId, issuer }
}

async function verifyMacSignatures(appPath) {
  const sidecar = path.join(appPath, 'Contents', 'Resources', 'sidecar', 'daemon')
  await run('codesign', ['--verify', '--strict', '--verbose=2', sidecar])
  await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
}

async function notarizeMac(appPath, environment) {
  const archive = path.join(path.dirname(appPath), `${path.basename(appPath, '.app')}-notarization.zip`)
  try {
    await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, archive])
    const credentials = appleNotaryCredentials(environment)
    if (!credentials) throw new Error('Apple notarization credentials are not configured')
    if (credentials.kind === 'profile') {
      await run(
        'xcrun',
        ['notarytool', 'submit', archive, '--keychain-profile', credentials.profile, '--wait'],
        [credentials.profile],
      )
    } else {
      const key = resolveAppleApiKey(credentials.key)
      try {
        await run(
          'xcrun',
          [
            'notarytool', 'submit', archive,
            '--key', key.path,
            '--key-id', credentials.keyId,
            '--issuer', credentials.issuer,
            '--wait',
          ],
          [key.path, credentials.keyId, credentials.issuer],
        )
      } finally {
        key.cleanup()
      }
    }
    await run('xcrun', ['stapler', 'staple', '-v', appPath])
    await run('xcrun', ['stapler', 'validate', '-v', appPath])
  } finally {
    rmSync(archive, { force: true })
  }
}

export function windowsExecutablePaths(appOutDir) {
  const executables = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(candidate)
      else if (entry.isFile() && /\.exe$/i.test(entry.name)) executables.push(candidate)
    }
  }
  visit(appOutDir)
  return executables.sort()
}

export async function verifyWindowsSignatures(context, runCommand = run) {
  const product = context.packager?.appInfo?.productFilename ?? 'Hermes Studio'
  const executable = path.join(context.appOutDir, `${product}.exe`)
  const sidecar = path.join(context.appOutDir, 'resources', 'sidecar', 'daemon.exe')
  for (const required of [executable, sidecar]) {
    if (!existsSync(required)) throw new Error(`Required Windows executable is missing: ${required}`)
  }
  const executables = windowsExecutablePaths(context.appOutDir)
  const command = [
    '$ErrorActionPreference = "Stop";',
    'foreach ($p in $args) {',
    '  $s = Get-AuthenticodeSignature -LiteralPath $p;',
    '  if ($s.Status -ne "Valid") { throw "Invalid Authenticode signature" }',
    '}',
  ].join(' ')
  await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command, ...executables])
}

export default async function afterSign(context) {
  const platform = context.electronPlatformName
  const disposition = packagingDisposition(platform)
  if (!disposition.signed) return

  if (platform === 'darwin') {
    const product = context.packager?.appInfo?.productFilename ?? 'Hermes Studio'
    const appPath = path.join(context.appOutDir, `${product}.app`)
    await verifyMacSignatures(appPath)
    if (disposition.channel === 'release') await notarizeMac(appPath, process.env)
    return
  }
  if (platform === 'win32') await verifyWindowsSignatures(context)
}
