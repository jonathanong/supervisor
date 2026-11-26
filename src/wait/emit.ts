import { randomUUID } from 'node:crypto'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { lastWaitPath, recordEvents } from '../state/hook-harness.js'
import { dumps, get, isObject, type Json, type JsonObject } from '../state/json.js'
import { expectArray, loadState, saveState, withStateLock } from '../state/store.js'
import { ownedBy, type WaitContext } from './context.js'

export interface WaitResult {
  /** The hook-harness result, with `events` reduced to the ones that need action. */
  data: JsonObject
  lines: JsonObject[]
  triggers: JsonObject[]
  /** Advance the stored cursor past the returned events. */
  advance: boolean
  /** A dependency update check has been pending for the configured delay. */
  due: boolean
}

/** The repositories of this owner that await a dependency update check, with the time each began. */
export function pendingChecks(state: JsonObject, owner: string): Array<{ repo: string; at: Json }> {
  const pending = expectArray(get(state, 'pendingUpdateChecks') ?? [], 'pendingUpdateChecks')
  return pending
    .filter(isObject)
    .filter((entry) => ownedBy(owner, entry.repo))
    .map((entry) => ({ repo: entry.repo as string, at: entry.at ?? null }))
}

/**
 * Write `hh-last.<owner>.json` and print the summary line, then one compact line per event and
 * per watch trigger. This owner's quiet merges are reported once and removed from state.
 */
export async function emit(ctx: WaitContext, result: WaitResult): Promise<void> {
  const { data, lines, triggers } = result
  const { quiet, pending } = await withStateLock(ctx.dir, async () => {
    const state = await loadState(ctx.dir)
    const log = expectArray(get(state, 'quietMerges') ?? [], 'quietMerges')
    state.quietMerges = log.filter((entry) => !ownedBy(ctx.owner, entry))
    if (result.advance) {
      recordEvents(state, ctx.owner, [], get(data, 'cursor') ?? null)
    }
    await saveState(ctx.dir, state)
    const repos = pendingChecks(state, ctx.owner).map((entry) => entry.repo)
    return {
      quiet: log.filter((entry) => ownedBy(ctx.owner, entry)),
      pending: [...new Set(repos)].sort(),
    }
  })
  const temporary = join(ctx.dir, `.hh-last.${randomUUID()}.json`)
  await writeFile(temporary, dumps(data), { mode: 0o600 })
  await rename(temporary, lastWaitPath(ctx.dir, ctx.owner))

  const summary: JsonObject = {}
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'events' && key !== 'cursor') {
      summary[key] = value
    }
  }
  summary.events = lines.length + triggers.length
  if (quiet.length > 0) {
    summary.quiet = { count: quiet.length, merges: quiet }
  }
  if (pending.length > 0) {
    summary.pendingUpdateChecks = pending
  }
  if (result.due) {
    summary.updateCheckDue = true
  }
  if (result.advance) {
    summary.advanced = true
  }
  for (const line of [summary, ...lines, ...triggers]) {
    ctx.write(`${dumps(line, true)}\n`)
  }
}
