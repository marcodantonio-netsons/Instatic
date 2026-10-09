import type { DataReadErrorCode } from './schemas'

export class RelationValidationError extends Error {
  readonly path: string
  readonly code: DataReadErrorCode
  constructor(path: string, code: DataReadErrorCode, message: string, options?: ErrorOptions) {
    super(`${path}: ${message}`, options)
    this.name = 'RelationValidationError'
    this.path = path
    this.code = code
  }
}

export class RelationResolutionError extends Error {
  readonly path: string
  readonly code: DataReadErrorCode
  constructor(path: string, code: DataReadErrorCode, message: string, options?: ErrorOptions) {
    super(`${path}: ${message}`, options)
    this.name = 'RelationResolutionError'
    this.path = path
    this.code = code
  }
}

export class DataReadGenerationError extends Error {
  readonly path: string
  readonly code = 'stale_generation' as const
  constructor(path = 'generation', options?: ErrorOptions) {
    super('Content changed during this read; reload and retry.', options)
    this.name = 'DataReadGenerationError'
    this.path = path
  }
}
