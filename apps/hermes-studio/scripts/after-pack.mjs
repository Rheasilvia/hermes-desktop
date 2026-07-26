import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { packagingDisposition } from './before-pack.mjs'

export const INTERNAL_BUILD_MARKER = 'INTERNAL-BUILD.txt'

export function resourcesDirectory(context) {
  if (context.electronPlatformName === 'darwin') {
    const product = context.packager?.appInfo?.productFilename ?? 'Hermes Studio'
    return path.join(context.appOutDir, `${product}.app`, 'Contents', 'Resources')
  }
  return path.join(context.appOutDir, 'resources')
}

export function writePackagingMarker(context, environment = process.env) {
  const resources = resourcesDirectory(context)
  const marker = path.join(resources, INTERNAL_BUILD_MARKER)
  const disposition = packagingDisposition(context.electronPlatformName, environment)
  if (disposition.channel === 'release') {
    rmSync(marker, { force: true })
    return marker
  }
  mkdirSync(resources, { recursive: true })
  writeFileSync(
    marker,
    [
      'Hermes Studio internal build',
      'This package is not approved for public distribution.',
      `platform=${context.electronPlatformName}`,
      `signed=${String(disposition.signed)}`,
      '',
    ].join('\n'),
    'utf8',
  )
  return marker
}

export default async function afterPack(context) {
  writePackagingMarker(context)
  if (packagingDisposition(context.electronPlatformName).channel !== 'release') {
    console.warn('[after-pack] marked package as internal; public signing/notarization is not fully configured')
  }
}
