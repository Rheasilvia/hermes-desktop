import type { NativeError } from '../src/shared/native-bridge.js'

export class NativeBridgeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'NativeBridgeError'
    this.code = code
  }
}

export function nativeError(code: string, message: string): NativeBridgeError {
  return new NativeBridgeError(code, message)
}

export function toNativeError(error: unknown, fallbackCode = 'NATIVE_OPERATION_FAILED'): NativeError {
  if (error instanceof NativeBridgeError) return { code: error.code, message: error.message }
  return { code: fallbackCode, message: 'Native operation failed' }
}
