import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dumpsIndented, put, type Json, type JsonObject } from './json.js'
import { withLock } from './lock.js'

/** A state file, argument value, or input file that does not have the shape a command needs. */
export class StateError extends Error {}

export type Kind = 'string' | 'object' | 'array'

/** The top-level fields and their shapes; `set`, `append`, and `remove` touch only these. */
export const FIELDS: Record<string, Kind> = {
  lastSweepAt: 'string',
  commandsThrough: 'string',
  reviewedComments: 'object',
  lateReview: 'object',
  schedule: 'object',
  retroCursor: 'string',
  escalations: 'object',
  hookHarness: 'object',
  handledFailures: 'object',
  shepherds: 'object',
  intake: 'array',
  scheduledPrompts: 'object',
  delegations: 'array',
  routed: 'array',
  watches: 'array',
  quietMerges: 'array',
  pendingUpdateChecks: 'array',
}

function kindOf(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  return Array.isArray(value) ? 'array' : typeof value
}

export function expectKind(value: unknown, kind: Kind, name: string): void {
  if (kindOf(value) !== kind) {
    throw new StateError(`state.json: ${name} must be ${kind}, got ${kindOf(value)}`)
  }
}

export function expectObject(value: unknown, name: string): JsonObject {
  expectKind(value, 'object', name)
  return value as JsonObject
}

export function expectArray(value: unknown, name: string): Json[] {
  expectKind(value, 'array', name)
  return value as Json[]
}

/** The object at `holder[key]`, created empty when absent. */
export function objectField(holder: JsonObject, key: string, name = key): JsonObject {
  if (!Object.hasOwn(holder, key)) {
    put(holder, key, {})
  }
  return expectObject(holder[key], name)
}

/** The list at `holder[key]`, created empty when absent. */
export function arrayField(holder: JsonObject, key: string, name = key): Json[] {
  if (!Object.hasOwn(holder, key)) {
    put(holder, key, [])
  }
  return expectArray(holder[key], name)
}

/** Parse JSON from an argument or a file, naming the source when it is malformed. */
export function parseJson(text: string, source: string): Json {
  try {
    return JSON.parse(text) as Json
  } catch (error) {
    throw new StateError(`${source}: ${(error as Error).message}`)
  }
}

/** UTC time to the second, the format of every time in state. */
export function timestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export async function loadState(dir: string): Promise<JsonObject> {
  let text: string
  try {
    text = await readFile(join(dir, 'state.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }
  return expectObject(parseJson(text, 'state.json'), 'state.json')
}

/** Replace `state.json` atomically: write a private temporary file beside it, then rename. */
export async function saveState(dir: string, state: JsonObject): Promise<void> {
  await mkdir(dir, { recursive: true })
  const temporary = join(dir, `.state.${randomUUID()}.json`)
  await writeFile(temporary, `${dumpsIndented(state)}\n`, { mode: 0o600 })
  await rename(temporary, join(dir, 'state.json'))
}

/** Hold the state lock for a whole read-modify-write. */
export async function withStateLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dir, { recursive: true })
  return await withLock(join(dir, 'state.lock'), fn)
}
