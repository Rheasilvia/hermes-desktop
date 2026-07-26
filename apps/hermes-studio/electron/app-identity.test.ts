// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { STUDIO_APP_ID, configureEarlyAppIdentity } from './app-identity.js'

describe('configureEarlyAppIdentity', () => {
  it('sets the packaged app id before Windows notifications are used', () => {
    const app = { setAppUserModelId: vi.fn() }
    configureEarlyAppIdentity(app, 'win32')
    expect(STUDIO_APP_ID).toBe('com.hermes-agent.studio')
    expect(app.setAppUserModelId).toHaveBeenCalledWith(STUDIO_APP_ID)
  })

  it('does not set an AppUserModelID outside Windows', () => {
    const app = { setAppUserModelId: vi.fn() }
    configureEarlyAppIdentity(app, 'darwin')
    expect(app.setAppUserModelId).not.toHaveBeenCalled()
  })

  it('stays tied to electron-builder appId', () => {
    const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const manifest = JSON.parse(readFileSync(path.join(studioRoot, 'package.json'), 'utf8')) as {
      build?: { appId?: string }
    }
    expect(manifest.build?.appId).toBe(STUDIO_APP_ID)
  })
})
