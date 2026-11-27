import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { dumps, dumpsIndented, put, type Json, type JsonObject } from './json.js'
import { withLock } from './lock.js'
import { FIELDS, fieldProblem, type Kind } from './schema.js'

/** A state file, argument value, or input file that does not have the shape a command needs. */
export class StateError extends Error {}

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
      return remember({})
    }
    throw error
  }
  return remember(expectObject(parseJson(text, 'state.json'), 'state.json'))
}

/** Each top-level field of a loaded state as it was read, to tell later which a write changed. */
const loaded = new WeakMap<JsonObject, Map<string, string>>()

function remember(state: JsonObject): JsonObject {
  loaded.set(state, new Map(Object.entries(state).map(([key, value]) => [key, dumps(value)])))
  return state
}

/** The first field this write added or changed that breaks `schemas/state.json`, as one line. */
function writeProblem(dir: string, state: JsonObject): string | undefined {
  const before = loaded.get(state) ?? new Map<string, string>()
  for (const [name, value] of Object.entries(state)) {
    const problem = before.get(name) === dumps(value) ? undefined : fieldProblem(name, value)
    if (problem !== undefined) {
      const fix = Object.hasOwn(FIELDS, name)
        ? `set the whole field with "supervisor state set ${name} --json ..." or `
        : ''
      return (
        `${resolve(dir, 'state.json')}: ${problem}; ${fix}` +
        `remove it with "supervisor state remove ${name}"`
      )
    }
  }
  return undefined
}

/**
 * Replace `state.json` atomically: write a private temporary file beside it, then rename. A field
 * the caller added or changed since `loadState` must fit `schemas/state.json`, or nothing is
 * written; a field left as it was, valid or not, never blocks the write, and reads never check.
 */
export async function saveState(dir: string, state: JsonObject): Promise<void> {
  const problem = writeProblem(dir, state)
  if (problem !== undefined) {
    throw new StateError(problem)
  }
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
