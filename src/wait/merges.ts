import { recordEvents } from '../state/hook-harness.js'
import { dumps, get, isObject, type Json, type JsonObject } from '../state/json.js'
import { checkLateReview } from '../state/late-review.js'
import { arrayField, loadState, saveState, timestamp, withStateLock } from '../state/store.js'
import type { WaitContext } from './context.js'
import { compact, isDependencyBot, isMerge, refOf } from './events.js'
import { updateWatches } from './watches.js'

/** How many clean merges state keeps until a wait reports them. */
const QUIET_KEEP = 100
const TRACKING = ['shepherds', 'routed', 'delegations', 'escalations', 'intake']
const DEFAULT_BOT = 'dependabot'

export interface Sweep {
  /** One compact line per event that needs action. */
  lines: JsonObject[]
  /** The same events as received. */
  raw: JsonObject[]
  triggers: JsonObject[]
}

/** The line for a merge with review findings or a failed check; undefined when it is clean. */
async function findings(
  ctx: WaitContext,
  event: JsonObject,
  ref: string,
): Promise<JsonObject | undefined> {
  let result
  try {
    result = await checkLateReview(ctx.run, ref)
  } catch (error) {
    // Any failure returns the merge to the loop rather than ending the wait.
    return { ...compact(event), lateReviewError: String((error as Error).message).slice(0, 200) }
  }
  if (!result.unresolved && !result.late && !result.truncated) {
    return undefined
  }
  const found = { unresolved: result.unresolved, late: result.late }
  return { ...compact(event), ...found, ...(result.truncated ? { truncated: true } : {}) }
}

/** True when a loop record (shepherd, routing, delegation, escalation, intake) names the PR. */
function tracked(state: JsonObject, ref: string): boolean {
  const needle = ref.slice(ref.indexOf('/') + 1).toLowerCase()
  return TRACKING.some((key) => {
    const text = dumps(get(state, key) ?? '').toLowerCase()
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
      if (!/\d/.test(text.charAt(at + needle.length))) {
        return true
      }
    }
    return false
  })
}

/**
 * Split a wait result's events into the ones that need action and watch triggers. A clean merge is
 * recorded in `quietMerges` (and `pendingUpdateChecks` for a dependency-bot pull request), its id
 * is marked seen, and watches are updated, all in one locked write.
 */
export async function sweep(events: Json[], ctx: WaitContext): Promise<Sweep> {
  const before = await loadState(ctx.dir)
  const harness = get(before, 'hookHarness')
  const mine = isObject(harness) ? get(harness, ctx.owner) : undefined
  const seen = isObject(mine) && Array.isArray(mine.seen) ? mine.seen : []
  const author = ctx.loaded.config.dependencyBot?.author ?? DEFAULT_BOT
  const lines: JsonObject[] = []
  const raw: JsonObject[] = []
  const quiet: string[] = []
  const quietIds: Json[] = []
  const bots = new Set<string>()
  const merged: string[] = []
  for (const event of events.filter(isObject)) {
    if (!isMerge(event)) {
      lines.push(compact(event))
      raw.push(event)
      continue
    }
    if (seen.includes(event.id ?? null)) {
      continue
    }
    const ref = refOf(event, ctx.owner)
    let line = await findings(ctx, event, ref)
    if (line === undefined && tracked(before, ref)) {
      line = { ...compact(event), tracked: true }
    }
    merged.push(ref)
    if (isDependencyBot(event, author)) {
      bots.add(ref.slice(0, ref.indexOf('#')))
    }
    if (line === undefined) {
      quiet.push(ref)
      quietIds.push(event.id ?? null)
    } else {
      lines.push(line)
      raw.push(event)
    }
  }
  const triggers = await withStateLock(ctx.dir, async () => {
    const state = await loadState(ctx.dir)
    const log = arrayField(state, 'quietMerges')
    state.quietMerges = [...log, ...quiet].slice(-QUIET_KEEP)
    const pending = arrayField(state, 'pendingUpdateChecks')
    const waiting = pending.map((entry) => (isObject(entry) ? entry.repo : undefined))
    for (const repo of bots) {
      if (!waiting.includes(repo)) {
        pending.push({ repo, at: timestamp(ctx.now()) })
      }
    }
    const found = updateWatches(state, merged)
    recordEvents(
      state,
      ctx.owner,
      quietIds.filter((id) => Boolean(id)),
      null,
    )
    await saveState(ctx.dir, state)
    return found
  })
  return { lines, raw, triggers }
}
