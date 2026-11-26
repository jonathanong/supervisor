import type { LoadedConfig } from '../config/load.js'
import type { RunProcess } from '../state/process.js'

/** What one `supervisor wait --owner <owner>` works with. */
export interface WaitContext {
  /** The state directory. */
  dir: string
  owner: string
  loaded: LoadedConfig
  run: RunProcess
  now: () => Date
  write: (text: string) => void
}

/** A wait that cannot continue; the message is printed and the command exits 1. */
export class WaitError extends Error {
  constructor(message: string) {
    super(`supervisor wait: ${message}`)
  }
}

/** `hook-harness` exited non-zero; the wait exits with the same code. */
export class HarnessExit extends Error {
  readonly code: number

  constructor(code: number) {
    super(`hook-harness exited ${code}`)
    this.code = code
  }
}

/** True for a `<owner>/...` state entry that belongs to this wait's owner. */
export function ownedBy(owner: string, entry: unknown): entry is string {
  return typeof entry === 'string' && entry.toLowerCase().startsWith(`${owner.toLowerCase()}/`)
}
