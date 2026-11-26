import { join } from 'node:path'
import type { Json, JsonObject } from './json.js'
import { arrayField, objectField } from './store.js'

/** How many recently seen event ids state keeps for each owner. */
const SEEN_MAX = 200

/** Where `supervisor wait --owner <owner>` leaves its result for `state advance-hh`. */
export function lastWaitPath(dir: string, owner: string): string {
  return join(dir, `hh-last.${owner}.json`)
}

/** Mark event ids seen for one owner and store that owner's cursor when there is one. */
export function recordEvents(state: JsonObject, owner: string, ids: Json[], cursor: Json): void {
  const name = `hookHarness.${owner}`
  const harness = objectField(objectField(state, 'hookHarness'), owner, name)
  const seen = arrayField(harness, 'seen', `${name}.seen`)
  for (const id of ids) {
    if (!seen.includes(id)) {
      seen.push(id)
    }
  }
  harness.seen = seen.slice(-SEEN_MAX)
  if (cursor) {
    harness.cursor = cursor
  }
}
