import path from 'node:path'
import { nativeError } from './native-errors.js'

export function expectRecord(value: unknown, label = 'arguments'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw nativeError('INVALID_ARGUMENT', `${label} must be an object`)
  }
  return value as Record<string, unknown>
}

export function expectString(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; trim?: boolean } = {},
): string {
  if (typeof value !== 'string') throw nativeError('INVALID_ARGUMENT', `${label} must be a string`)
  const result = options.trim ? value.trim() : value
  if (result.length < (options.min ?? 0)) throw nativeError('INVALID_ARGUMENT', `${label} is required`)
  if (result.length > (options.max ?? 4_096)) throw nativeError('INVALID_ARGUMENT', `${label} is too long`)
  if (result.includes('\0')) throw nativeError('INVALID_ARGUMENT', `${label} contains an invalid character`)
  return result
}

export function expectInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw nativeError('INVALID_ARGUMENT', `${label} must be an integer between ${minimum} and ${maximum}`)
  }
  return Number(value)
}

export function expectSessionId(value: unknown): string {
  const id = expectString(value, 'sessionId', { min: 1, max: 256, trim: true })
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id)) {
    throw nativeError('INVALID_SESSION_ID', 'sessionId contains unsupported characters')
  }
  return id
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function assertRelativePath(value: unknown): string {
  if (typeof value === 'string' && value.includes('\0')) {
    throw nativeError('INVALID_PATH', 'path contains an invalid character')
  }
  const relative = expectString(value, 'path', { max: 4_096 })
  if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:[\\/]/.test(relative)) {
    throw nativeError('INVALID_PATH', 'path must be relative to HERMES_HOME')
  }
  const normalized = path.normalize(relative)
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw nativeError('PATH_OUTSIDE_HERMES_HOME', 'path escapes HERMES_HOME')
  }
  return normalized
}
