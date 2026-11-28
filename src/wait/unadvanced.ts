import { readFile } from 'node:fs/promises'
import type { LoadedConfig } from '../config/load.js'
import { ownersOf } from '../config/repos.js'
import { lastWaitPath, seenIds } from '../state/hook-harness.js'
import { get, isObject, type JsonObject } from '../state/json.js'
import { loadState, parseJson } from '../state/store.js'
import type { WaitContext } from './context.js'

/** The exit code of a wait that refused to start over events that were not advanced. */
export const UNADVANCED_EXIT = 4

/** The previous result still holds events that `supervisor state advance-hh` has not recorded. */
export class UnadvancedError extends Error {
  constructor() {
    super(
      'supervisor wait: hh-last.json holds events that were not advanced; ' +
        'run "supervisor state advance-hh" first',
    )
  }
}

/**
 * Read the previous wait result (`hh-last.json`), or `undefined` when it is absent or not a JSON
 * object. Invalid JSON and other read errors throw.
 */
export async function readLastWait(dir: string): Promise<JsonObject | undefined> {
  const path = lastWaitPath(dir)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  const last = parseJson(text, path)
  return isObject(last) ? last : undefined
}

/**
 * Per-owner consecutive relay error counts carried from the previous `hh-last.json`, limited to
 * currently configured owners. Keys are lowercased to match `hook-harness`'s `pollEvents`, which
 * emits `batch.owner` in lowercase. Invalid or non-positive entries are ignored.
 */
export function priorRelayErrors(
  last: JsonObject | undefined,
  loaded: LoadedConfig,
): Map<string, number> {
  const errors = new Map<string, number>()
  const stored = last === undefined ? undefined : get(last, 'relayErrors')
  if (!isObject(stored)) {
    return errors
  }
  const configured = new Set(ownersOf(loaded).map((owner) => owner.toLowerCase()))
  for (const [owner, count] of Object.entries(stored)) {
    const key = owner.toLowerCase()
    if (configured.has(key) && Number.isInteger(count) && (count as number) > 0) {
      errors.set(key, count as number)
    }
  }
  return errors
}

/**
 * Refuse to start when the previous result file holds an event whose id is not in
 * `hookHarness.seen`. `advance-hh` marks every id in the file seen and stores the cursor in
 * one write, and a wait that advances itself does the same at return, so a missing id means the
 * events were not advanced and a new wait from the stored cursor would return them again. The
 * cursor is not compared: a result with no events, or one the cursor already moved past, is fine.
 */
export async function refuseUnadvanced(
  ctx: WaitContext,
  last: JsonObject | undefined,
): Promise<void> {
  if (last === undefined) {
    return
  }
  const events = get(last, 'events')
  const seen = seenIds(await loadState(ctx.dir))
  const ids = (Array.isArray(events) ? events : []).filter(isObject).map((event) => event.id)
  if (ids.some((id) => id !== undefined && !seen.includes(id))) {
    throw new UnadvancedError()
  }
}
