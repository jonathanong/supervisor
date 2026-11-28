import { recordEvents, seenIds } from '../state/hook-harness.js'
import { dumps, get, isObject, type Json, type JsonObject } from '../state/json.js'
import { checkLateReview } from '../state/late-review.js'
import { arrayField, loadState, saveState, timestamp, withStateLock } from '../state/store.js'
import type { WaitContext } from './context.js'
import { compact, isDependencyBot, isMerge, refOf } from './events.js'
import { updateWatches } from './watches.js'

/** How many clean merges state keeps until a wait reports them. */
const QUIET_KEEP = 100
const TRACKING = ['routed', 'delegations', 'escalations', 'intake']
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

/**
 * True when `text` names the pull request `needle` as a whole: not inside a longer owner or
 * repository name, and not as the start of a longer number. With `bare`, a match that follows a
 * slash is skipped too, because that names the repository under some owner.
 */
function mentions(text: string, needle: string, bare: boolean): boolean {
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const before = text.charAt(at - 1)
    const inName = /[\w.-]/.test(before) || (bare && before === '/')
    if (!inName && !/\d/.test(text.charAt(at + needle.length))) {
      return true
    }
  }
  return false
}

/**
 * True when a loop record (routing, delegation, escalation, intake) names the PR as
 * `<owner>/<repo>#N`, so the same-named repository of another owner does not match. A record that
 * names it as `<repo>#N` with no owner (free text, or an entry from before records carried the
 * owner) still matches: it cannot be told apart, and a merge reported once too often costs less
 * than a tracked one that is missed.
 */
function tracked(state: JsonObject, ref: string): boolean {
  const full = ref.toLowerCase()
  const short = full.slice(full.indexOf('/') + 1)
  return TRACKING.some((key) => {
    const text = dumps(get(state, key) ?? '').toLowerCase()
    return mentions(text, full, false) || mentions(text, short, true)
  })
}

/**
 * Split a wait result's events into the ones that need action and watch triggers. A clean merge is
 * recorded in `quietMerges` (and `pendingUpdateChecks` for a dependency-bot pull request), its id
 * is marked seen, and watches are updated, all in one locked write.
 */
export async function sweep(events: Json[], ctx: WaitContext): Promise<Sweep> {
  const before = await loadState(ctx.dir)
  const seen = seenIds(before)
  const author = ctx.loaded.config.dependencyBot?.author ?? DEFAULT_BOT
  const lines: JsonObject[] = []
  const raw: JsonObject[] = []
  const quiet: string[] = []
  const quietIds: Json[] = []
  const bots = new Set<string>()
  const merged: string[] = []
  for (const event of events.filter(isObject)) {
    if (event.id !== undefined && seen.includes(event.id)) {
      continue
    }
    if (!isMerge(event)) {
      lines.push(compact(event))
      raw.push(event)
      continue
    }
    const ref = refOf(event)
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
      quietIds.filter((id) => Boolean(id)),
      null,
    )
    await saveState(ctx.dir, state)
    return found
  })
  return { lines, raw, triggers }
}
