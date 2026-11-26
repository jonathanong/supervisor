import { get, isObject, type Json, type JsonObject } from '../state/json.js'
import { expectArray, loadState, saveState, withStateLock } from '../state/store.js'

function lowered(refs: Json | undefined): string[] {
  const list = Array.isArray(refs) ? refs : []
  return list.filter((ref) => typeof ref === 'string').map((ref) => ref.toLowerCase())
}

/**
 * Record merged pull requests in each watch and return a trigger for every complete watch not yet
 * acknowledged. A trigger repeats on each wait until `state watch ack` or `state watch remove`, so
 * a crash cannot lose it. Watches are shared by every owner's wait.
 */
export function updateWatches(state: JsonObject, merged: string[]): JsonObject[] {
  const triggers: JsonObject[] = []
  for (const watch of expectArray(get(state, 'watches') ?? [], 'watches')) {
    if (!isObject(watch)) {
      continue
    }
    const wanted = lowered(watch.prs)
    const arrived = lowered(merged).filter((ref) => wanted.includes(ref))
    const done = [...new Set([...lowered(watch.merged), ...arrived])].sort()
    watch.merged = done
    if (wanted.every((ref) => done.includes(ref)) && !watch.ackedAt) {
      triggers.push({
        event: 'watch',
        id: watch.id ?? null,
        notify: watch.notify ?? null,
        note: watch.note === undefined ? '' : watch.note,
        prs: watch.prs ?? [],
      })
    }
  }
  return triggers
}

/** Triggers for watches that are already complete and unacknowledged, without new events. */
export async function watchTriggers(dir: string): Promise<JsonObject[]> {
  return await withStateLock(dir, async () => {
    const state = await loadState(dir)
    const triggers = updateWatches(state, [])
    await saveState(dir, state)
    return triggers
  })
}
