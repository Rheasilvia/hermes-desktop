// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { NativeShutdownCoordinator, runNativeCleanup } from './shutdown-coordinator.js'

describe('native shutdown', () => {
  it('prevents every quit while one cleanup promise is in progress', async () => {
    let finish!: () => void
    const cleanup = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const quit = vi.fn()
    const coordinator = new NativeShutdownCoordinator(cleanup, quit)
    const first = { preventDefault: vi.fn() }
    const second = { preventDefault: vi.fn() }

    coordinator.handleBeforeQuit(first)
    coordinator.handleBeforeQuit(second)
    expect(first.preventDefault).toHaveBeenCalledOnce()
    expect(second.preventDefault).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()

    finish()
    await coordinator.promise
    expect(quit).toHaveBeenCalledOnce()

    const final = { preventDefault: vi.fn() }
    coordinator.handleBeforeQuit(final)
    expect(final.preventDefault).not.toHaveBeenCalled()
  })

  it('runs every cleanup step even when window-state save and other steps fail', async () => {
    const calls: string[] = []
    const report = vi.fn()
    await runNativeCleanup({
      saveWindowState: () => { calls.push('save'); throw new Error('disk full') },
      shutdownTerminals: () => { calls.push('terminal') },
      shutdownNotifications: () => { calls.push('notification'); throw new Error('notification failure') },
      clearAssetHandles: () => { calls.push('assets') },
      clearWorkspaceGrants: () => { calls.push('grants') },
      clearAttachmentStaging: async () => { calls.push('staging') },
      stopSidecar: async () => { calls.push('sidecar') },
      report,
    })

    expect(calls).toEqual(['save', 'terminal', 'notification', 'assets', 'grants', 'staging', 'sidecar'])
    expect(report).toHaveBeenCalledTimes(2)
  })
})
