import { execFile } from 'node:child_process'
import { nativeError } from './native-errors.js'
import { isAllowedExternalUrl } from './security-policy.js'

export interface SystemOperationsOptions {
  platform?: NodeJS.Platform
  openExternal: (url: string) => Promise<unknown>
  execFile?: typeof execFile
}

export class SystemOperations {
  readonly #platform: NodeJS.Platform
  readonly #openExternal: (url: string) => Promise<unknown>
  readonly #execFile: typeof execFile

  constructor(options: SystemOperationsOptions) {
    this.#platform = options.platform ?? process.platform
    this.#openExternal = options.openExternal
    this.#execFile = options.execFile ?? execFile
  }

  async openExternal(rawUrl: unknown): Promise<void> {
    if (typeof rawUrl !== 'string' || !isAllowedExternalUrl(rawUrl)) {
      throw nativeError('EXTERNAL_URL_NOT_ALLOWED', 'External URL is not allowed')
    }
    await this.#openExternal(rawUrl)
  }

  async installMacosCommandLineTools(): Promise<void> {
    if (this.#platform !== 'darwin') {
      throw nativeError('MACOS_COMMAND_LINE_TOOLS_UNAVAILABLE', 'Command Line Tools installation is available only on macOS')
    }
    await new Promise<void>((resolve, reject) => {
      this.#execFile('/usr/bin/xcode-select', ['--install'], { timeout: 15_000, windowsHide: true }, (error, _stdout, stderr) => {
        if (!error || stderr.includes('already installed')) {
          resolve()
          return
        }
        reject(nativeError('MACOS_COMMAND_LINE_TOOLS_FAILED', 'Command Line Tools installer did not launch'))
      })
    })
  }
}
