// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { NotificationManager, type NotificationHandle } from './notification-manager.js'

class FakeNotification extends EventEmitter implements NotificationHandle {
  show = vi.fn()
  close = vi.fn(() => this.emit('close'))
}

describe('NotificationManager', () => {
  it('shows notifications, focuses on click, routes supported actions, and cleans up', () => {
    const handles: FakeNotification[] = []
    const options: unknown[] = []
    const focus = vi.fn()
    const manager = new NotificationManager({
      platform: 'darwin',
      isSupported: () => true,
      create: (value) => {
        options.push(value)
        const handle = new FakeNotification()
        handles.push(handle)
        return handle
      },
      focus,
    })
    const clicked = vi.fn()
    const action = vi.fn()
    manager.on('click', clicked)
    manager.on('action', action)

    const result = manager.show({
      title: 'Approval needed',
      body: 'Run command?',
      actions: [{ id: 'approve', title: 'Approve' }, { id: 'deny', title: 'Deny' }],
      context: { sessionId: 'desktop_1', command: 'echo ok' },
    })
    expect(result.actionsSupported).toBe(true)
    expect(options[0]).toMatchObject({ actions: [{ type: 'button', text: 'Approve' }, { type: 'button', text: 'Deny' }] })

    handles[0]?.emit('click')
    handles[0]?.emit('action', {}, 1)
    expect(focus).toHaveBeenCalledTimes(2)
    expect(clicked).toHaveBeenCalledWith({ id: result.id, context: { sessionId: 'desktop_1', command: 'echo ok' } })
    expect(action).toHaveBeenCalledWith({ id: result.id, actionId: 'deny', context: { sessionId: 'desktop_1', command: 'echo ok' } })

    manager.shutdown()
    expect(handles[0]?.close).toHaveBeenCalledOnce()
  })

  it('degrades action buttons on unsupported platforms while retaining the notification', () => {
    const options: unknown[] = []
    const handle = new FakeNotification()
    const manager = new NotificationManager({
      platform: 'linux',
      isSupported: () => true,
      create: (value) => { options.push(value); return handle },
      focus: vi.fn(),
    })

    const result = manager.show({
      title: 'Approval needed', body: 'Open the app to approve',
      actions: [{ id: 'approve', title: 'Approve' }],
    })
    expect(result.actionsSupported).toBe(false)
    expect(options[0]).not.toHaveProperty('actions')
    expect(handle.show).toHaveBeenCalledOnce()
  })

  it('returns a stable error when native notifications are unavailable', () => {
    const manager = new NotificationManager({
      platform: 'linux', isSupported: () => false,
      create: () => new FakeNotification(), focus: vi.fn(),
    })
    expect(() => manager.show({ title: 'x', body: 'y' })).toThrow(/not supported/i)
  })
})
