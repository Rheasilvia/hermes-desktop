export interface NativeCleanupTasks {
  saveWindowState(): void
  shutdownTerminals(): void
  shutdownNotifications(): void
  clearAssetHandles(): void
  clearWorkspaceGrants(): void
  clearAttachmentStaging(): void | Promise<void>
  stopSidecar(): void | Promise<void>
  report?(step: string, error: unknown): void
}

export async function runNativeCleanup(tasks: NativeCleanupTasks): Promise<void> {
  const run = async (step: string, operation: () => void | Promise<void>): Promise<void> => {
    try {
      await operation()
    } catch (error) {
      tasks.report?.(step, error)
    }
  }
  await run('window-state', tasks.saveWindowState)
  await run('terminals', tasks.shutdownTerminals)
  await run('notifications', tasks.shutdownNotifications)
  await run('assets', tasks.clearAssetHandles)
  await run('workspace-grants', tasks.clearWorkspaceGrants)
  await run('attachment-staging', tasks.clearAttachmentStaging)
  await run('sidecar', tasks.stopSidecar)
}

type ShutdownState = 'idle' | 'in_progress' | 'finished'

export class NativeShutdownCoordinator {
  #state: ShutdownState = 'idle'
  #promise: Promise<void> | undefined

  constructor(
    private readonly cleanup: () => void | Promise<void>,
    private readonly quit: () => void,
    private readonly report: (error: unknown) => void = () => undefined,
  ) {}

  get promise(): Promise<void> | undefined { return this.#promise }

  handleBeforeQuit(event: { preventDefault(): void }): void {
    if (this.#state === 'finished') return
    event.preventDefault()
    if (this.#state === 'in_progress') return
    this.#state = 'in_progress'
    let cleanupResult: void | Promise<void>
    try {
      cleanupResult = this.cleanup()
    } catch (error) {
      cleanupResult = Promise.reject(error)
    }
    this.#promise = Promise.resolve(cleanupResult)
      .catch(this.report)
      .finally(() => {
        this.#state = 'finished'
        this.quit()
      })
  }
}
