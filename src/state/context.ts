import type { Json } from './json.js'
import type { RunProcess } from './process.js'

/** A subcommand called with arguments it cannot accept; the caller prints the help and exits 2. */
export class UsageError extends Error {}

/** True for a `UsageError` and for an argument `parseArgs` rejected. */
export function isUsageError(error: unknown): boolean {
  const code = (error as { code?: unknown }).code
  return (
    error instanceof UsageError || (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS'))
  )
}

/** What every `supervisor state` subcommand works with. */
export interface StateContext {
  /** The state directory. */
  dir: string
  /** How many scheduled-prompt runs to keep. */
  history: number
  /** The distinct owners of the configured scopes, in order. */
  owners: string[]
  run: RunProcess
  /** The current UTC time, to the second. */
  now: () => string
  /** Print one value as a line of JSON. */
  print: (value: Json) => void
  write: (text: string) => void
}

export const TEXT = { type: 'string' } as const
export const FLAG = { type: 'boolean' } as const
export const TEXTS = { type: 'string', multiple: true } as const

export function need(value: string | undefined, flag: string): string {
  if (value === undefined) {
    throw new UsageError(`--${flag} is required`)
  }
  return value
}

/** Owner and repository names: safe in a file name, a URL path, and generated script text. */
export const NAME = /^[\w.-]+$/

/** `<owner>/<repo>`, the key of every per-repository record. */
export const REPOSITORY = /^[\w.-]+\/[\w.-]+$/
