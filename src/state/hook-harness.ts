import { join } from 'node:path'
import { get, isObject, type Json, type JsonObject } from './json.js'
import { arrayField, objectField } from './store.js'

/** How many recently seen event ids state keeps. */
const SEEN_MAX = 200

/** Where `supervisor wait` leaves its result for `state advance-hh`. */
export function lastWaitPath(dir: string): string {
  return join(dir, 'hh-last.json')
}

/**
 * The event ids that 0.3.0 stored per owner, as `hookHarness.<owner>.seen`. A legacy entry is told
 * apart by its shape, an object, so an owner named `seen` or `cursor` still counts as one.
 */
function legacySeen(harness: JsonObject): Json[] {
  return Object.values(harness).flatMap((entry) => {
    const seen = isObject(entry) ? get(entry, 'seen') : undefined
    return Array.isArray(seen) ? seen : []
  })
}

/** The seen event ids: `hookHarness.seen` and any ids a 0.3.0 per-owner entry still holds. */
export function seenIds(state: JsonObject): Json[] {
  const harness = get(state, 'hookHarness')
  if (!isObject(harness)) {
    return []
  }
  const seen = get(harness, 'seen')
  return [...(Array.isArray(seen) ? seen : []), ...legacySeen(harness)]
}

/**
 * Mark event ids seen and store the cursor when there is one. A 0.3.0 state holds
 * `hookHarness.<owner>.{cursor,seen}`: those entries are dropped and their seen ids merged in, so
 * the field fits the schema when this write changes it. Their cursors cannot be combined, so the
 * next wait starts from `--since` when no new cursor is stored, and events older than that are
 * not returned.
 */
export function recordEvents(state: JsonObject, ids: Json[], cursor: Json): void {
  const harness = objectField(state, 'hookHarness')
  const legacy = legacySeen(harness)
  for (const [key, entry] of Object.entries(harness)) {
    if (isObject(entry) || (key !== 'cursor' && key !== 'seen')) {
      delete harness[key]
    }
  }
  const merged = [...arrayField(harness, 'seen', 'hookHarness.seen'), ...legacy]
  harness.seen = [...new Set([...merged, ...ids].filter((id) => typeof id === 'string'))].slice(
    -SEEN_MAX,
  )
  if (cursor) {
    harness.cursor = cursor
  }
}
