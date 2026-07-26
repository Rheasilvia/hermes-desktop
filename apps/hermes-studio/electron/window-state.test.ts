// @vitest-environment node
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
