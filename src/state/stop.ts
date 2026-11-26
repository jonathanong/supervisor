import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dumps, isObject } from './json.js'

/** The exit code of a command that refused to act, or reported, because the stop switch is set. */
export const STOPPED_EXIT = 3

/** The stop switch as recorded; a file made by hand has neither a time nor a reason. */
export interface Stop {
  at: string | null
  reason: string | null
}

/** A command refused to act because the stop switch is set; the caller exits `STOPPED_EXIT`. */
export class StoppedError extends Error {}

/** The stop switch is this one file. Its existence is the switch; its content only explains it. */
export function stopPath(dir: string): string {
  return join(dir, 'stop')
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * The stop switch, or undefined when it is not set. No lock is taken, so a stuck state lock never
 * hides a stop. Anything at the path counts: an empty file, text that is not JSON, or an entry that
 * cannot be read all mean stopped.
 */
export async function readStop(dir: string): Promise<Stop | undefined> {
  let content: string
  try {
    content = await readFile(stopPath(dir), 'utf8')
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
    return missing ? undefined : { at: null, reason: null }
  }
  let record: unknown
  try {
    record = JSON.parse(content)
  } catch {
    record = undefined
  }
  return isObject(record)
    ? { at: text(record.at), reason: text(record.reason) }
    : { at: null, reason: null }
}

/** Set the stop switch, replacing an earlier one. Takes no lock. */
export async function setStop(dir: string, at: string, reason: string | undefined): Promise<Stop> {
  const stop: Stop = { at, reason: text(reason) }
  await mkdir(dir, { recursive: true })
  await rm(stopPath(dir), { recursive: true, force: true })
  await writeFile(stopPath(dir), `${dumps({ ...stop })}\n`, { mode: 0o600 })
  return stop
}

/** Remove the stop switch and return what it held; undefined when it was not set. Takes no lock. */
export async function clearStop(dir: string): Promise<Stop | undefined> {
  const stop = await readStop(dir)
  await rm(stopPath(dir), { recursive: true, force: true })
  return stop
}

/** Throw `StoppedError`, with one line that names the file, when the stop switch is set. */
export async function refuseWhenStopped(dir: string, command: string): Promise<void> {
  const stop = await readStop(dir)
  if (stop !== undefined) {
    const since = stop.at === null ? '' : ` since ${stop.at}`
    const why = stop.reason === null ? '' : ` (${stop.reason})`
    throw new StoppedError(
      `${command}: stopped by ${stopPath(dir)}${since}${why}; "supervisor resume" clears it`,
    )
  }
}
