// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  focusExistingWindow,
  resolveStudioUserData,
  sanitizeWindowState,
  type DisplayBounds,
  type WindowLike,
} from './window-state.js'

const displays: DisplayBounds[] = [{ x: 0, y: 0, width: 1920, height: 1080 }]

describe('window lifecycle helpers', () => {
  it('accepts visible bounded state and falls back for invalid/off-screen values', () => {
    expect(sanitizeWindowState({ x: 100, y: 100, width: 1200, height: 800, maximized: true }, displays))
      .toEqual({ x: 100, y: 100, width: 1200, height: 800, maximized: true })
    expect(sanitizeWindowState({ x: 9000, y: 9000, width: 1200, height: 800, maximized: false }, displays))
      .toEqual({ width: 1200, height: 800, maximized: false })
    expect(sanitizeWindowState({ x: 1, y: 1, width: 1, height: Number.NaN, maximized: 'yes' }, displays))
      .toEqual({ width: 1200, height: 800, maximized: false })
  })

  it('uses a dedicated Electron userData directory', () => {
    expect(resolveStudioUserData('/Users/test/Library/Application Support'))
      .toBe('/Users/test/Library/Application Support/hermes-studio-electron')
  })

  it('uses an isolated userData directory only for a marked packaged smoke launch', () => {
    const smokeRoot = mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-packaged-smoke-'))
    const isolatedUserData = path.join(smokeRoot, 'electron-user-data')
    mkdirSync(isolatedUserData)

    try {
      expect(resolveStudioUserData('/real/app-data', {
        env: {
          HERMES_STUDIO_INTERNAL_PACKAGED_SMOKE: '1',
          HERMES_STUDIO_INTERNAL_PACKAGED_SMOKE_USER_DATA: isolatedUserData,
        },
        isPackaged: true,
        temporaryRoot: os.tmpdir(),
      })).toBe(realpathSync(isolatedUserData))
    } finally {
      rmSync(smokeRoot, { recursive: true, force: true })
    }
  })

  it('rejects an unmarked, unpackaged, or non-smoke userData override', () => {
    const smokeRoot = mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-packaged-smoke-'))
    const isolatedUserData = path.join(smokeRoot, 'electron-user-data')
    const unrelatedRoot = mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-unrelated-'))
    const unrelatedUserData = path.join(unrelatedRoot, 'electron-user-data')
    mkdirSync(isolatedUserData)
    mkdirSync(unrelatedUserData)

    try {
      expect(() => resolveStudioUserData('/real/app-data', {
        env: { HERMES_STUDIO_INTERNAL_PACKAGED_SMOKE_USER_DATA: isolatedUserData },
        isPackaged: true,
        temporaryRoot: os.tmpdir(),
      })).toThrow(/packaged smoke marker/i)
      expect(() => resolveStudioUserData('/real/app-data', {
        env: {
          HERMES_STUDIO_INTERNAL_PACKAGED_SMOKE: '1',
          HERMES_STUDIO_INTERNAL_PACKAGED_SMOKE_USER_DATA: isolatedUserData,
        },
        isPackaged: false,
        temporaryRoot: os.tmpdir(),
      })).toThrow(/packaged application/i)
      expect(() => resolveStudioUserData('/real/app-data', {
        env: {
          HERMES_STUDIO_INTERNAL_PACKAGED_SMOKE: '1',
          HERMES_STUDIO_INTERNAL_PACKAGED_SMOKE_USER_DATA: unrelatedUserData,
        },
        isPackaged: true,
        temporaryRoot: os.tmpdir(),
      })).toThrow(/packaged smoke directory/i)
    } finally {
      rmSync(smokeRoot, { recursive: true, force: true })
      rmSync(unrelatedRoot, { recursive: true, force: true })
    }
  })

  it('restores and focuses an existing window for a second instance', () => {
    const window: WindowLike = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }

    expect(focusExistingWindow(window)).toBe(true)
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(focusExistingWindow(undefined)).toBe(false)
  })
})
