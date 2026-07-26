// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AssetRegistry } from './assets.js'
import { ClipboardImages, type NativeImageLike } from './clipboard-images.js'
import { SystemOperations } from './system-ops.js'
import { selectWorkspaceForSession, WorkspaceGrants } from './workspace-grants.js'

describe('native bridge service adapters', () => {
  it('keeps selected workspace grants in main while PATCHing the canonical cwd', async () => {
    const selected = mkdtempSync(path.join(tmpdir(), 'studio-workspace-'))
    const grants = new WorkspaceGrants()
    const updateSessionCwd = vi.fn(async (_sessionId: string, cwd: string) => cwd)

    const result = await selectWorkspaceForSession({
      sessionId: 'desktop_1',
      pickDirectory: async () => selected,
      updateSessionCwd,
      grants,
    })

    expect(result).toContain('studio-workspace-')
    expect(updateSessionCwd).toHaveBeenCalledWith('desktop_1', result)
    expect(grants.roots()).toEqual([result])
    expect(JSON.stringify({ result })).not.toContain('grant')
    await expect(selectWorkspaceForSession({
      sessionId: 'desktop_1', pickDirectory: async () => undefined, updateSessionCwd, grants,
    })).rejects.toMatchObject({ code: 'WORKSPACE_SELECTION_CANCELLED' })
  })

  it('persists clipboard PNGs behind opaque URLs and copies decoded remote images', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-clipboard-service-'))
    const registry = new AssetRegistry({ allowedRoots: () => [root] })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const clipboardImage: NativeImageLike = { isEmpty: () => false, toPNG: () => png }
    const remoteImage: NativeImageLike = { isEmpty: () => false, toPNG: () => png }
    const writeImage = vi.fn()
    const fetchImage = vi.fn(async () => png)
    const images = new ClipboardImages({
      managedRoot: root,
      registry,
      readImage: () => clipboardImage,
      writeImage,
      createImage: () => remoteImage,
      fetchImage,
    })

    const asset = await images.read()
    expect(asset?.path).toContain(root)
    expect(asset?.url).toMatch(/^hermes-studio-asset:\/\/asset\//)
    expect(asset?.url).not.toContain(root)
    await images.copyRemote('https://example.com/image.png')
    expect(fetchImage).toHaveBeenCalledWith('https://example.com/image.png')
    expect(writeImage).toHaveBeenCalledWith(remoteImage)
  })

  it('opens only validated external URLs and returns a stable non-macOS installer error', async () => {
    const openExternal = vi.fn(async () => undefined)
    const system = new SystemOperations({ platform: 'linux', openExternal })

    await system.openExternal('https://example.com')
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    await expect(system.openExternal('file:///etc/passwd')).rejects.toMatchObject({ code: 'EXTERNAL_URL_NOT_ALLOWED' })
    await expect(system.installMacosCommandLineTools()).rejects.toMatchObject({ code: 'MACOS_COMMAND_LINE_TOOLS_UNAVAILABLE' })
  })
})
