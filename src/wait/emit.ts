import { randomUUID } from 'node:crypto'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inReportMode } from '../config/repos.js'
import type { LoadedConfig } from '../config/load.js'
import { lastWaitPath, recordEvents } from '../state/hook-harness.js'
import { dumps, get, isObject, type Json, type JsonObject } from '../state/json.js'
import { expectArray, loadState, saveState, withStateLock } from '../state/store.js'
import type { WaitContext } from './context.js'

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

/**
 * The repositories that await a dependency update check, with the time each began. An entry for a
 * repository in a report-mode scope is skipped: the loop cannot run the check there.
 */
export function pendingChecks(
  state: JsonObject,
  loaded: LoadedConfig,
): Array<{ repo: string; at: Json }> {
  const pending = expectArray(get(state, 'pendingUpdateChecks') ?? [], 'pendingUpdateChecks')
  return pending
    .filter(isObject)
    .filter((entry) => typeof entry.repo === 'string')
    .filter((entry) => !inReportMode(loaded, entry.repo as string))
    .map((entry) => ({ repo: entry.repo as string, at: entry.at ?? null }))
}

/**
 * Write `hh-last.json` and print the summary line, then one compact line per event and per watch
 * trigger. The quiet merges are reported once and removed from state.
 */
export async function emit(ctx: WaitContext, result: WaitResult): Promise<void> {
  const { data, lines, triggers } = result
  const { quiet, pending } = await withStateLock(ctx.dir, async () => {
    const state = await loadState(ctx.dir)
    const log = expectArray(get(state, 'quietMerges') ?? [], 'quietMerges')
    state.quietMerges = log.filter((entry) => typeof entry !== 'string')
    if (result.advance) {
      const ids = expectArray(get(data, 'events'), 'events')
        .filter(isObject)
        .map((event) => event.id)
        .filter((id) => id !== undefined)
      recordEvents(state, ids, get(data, 'cursor') ?? null)
    }
    await saveState(ctx.dir, state)
    const repos = pendingChecks(state, ctx.loaded).map((entry) => entry.repo)
    return {
      quiet: log.filter((entry) => typeof entry === 'string'),
      pending: [...new Set(repos)].sort(),
    }
  })
  const temporary = join(ctx.dir, `.hh-last.${randomUUID()}.json`)
  await writeFile(temporary, dumps(data), { mode: 0o600 })
  await rename(temporary, lastWaitPath(ctx.dir))

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
