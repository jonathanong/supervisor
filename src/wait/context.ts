import type { LoadedConfig } from '../config/load.js'
import type { RunProcess } from '../state/process.js'

/** What one `supervisor wait` works with. */
export interface WaitContext {
  /** The state directory. */
  dir: string
  loaded: LoadedConfig
  env: Record<string, string | undefined>
  run: RunProcess
  now: () => Date
  write: (text: string) => void
  fetch?: typeof fetch
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  timeoutSignal?: (ms: number) => AbortSignal
}

/** A wait that cannot continue; the message is printed and the command exits 1. */
export class WaitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`supervisor wait: ${message}`, options)
  }
}
