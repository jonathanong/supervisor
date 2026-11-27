import { recordEvents } from '../state/hook-harness.js'
import { get } from '../state/json.js'
import { refuseWhenStopped } from '../state/stop.js'
import { loadState, saveState, withStateLock } from '../state/store.js'
import { WaitError, type WaitContext } from './context.js'
import { emit, pendingChecks } from './emit.js'
import { hookHarnessWait, listRepositories } from './harness.js'
import { sweep } from './merges.js'
import { refuseUnadvanced } from './unadvanced.js'
import { watchTriggers } from './watches.js'

const UNITS: Record<string, number> = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }

export interface WaitSettings {
  /** The longest the whole wait may take, for example `2h`. */
  timeout: string
  /** How long after the oldest pending update check the wait returns, for example `10m`. */
  updateCheckDelay: string
  advance: boolean
}

function seconds(text: string): number {
  const match = /^(\d+)([smhd]?)$/.exec(text)
  if (!match) {
    throw new WaitError(`duration '${text}' must look like 90s, 10m, or 2h`)
  }
  return Number(match[1]) * UNITS[match[2]!]!
}

/** Seconds until this owner's oldest pending update check is due; undefined when none is. */
async function pendingDeadline(ctx: WaitContext, delay: number): Promise<number | undefined> {
  const pending = pendingChecks(await loadState(ctx.dir), ctx.owner)
  if (pending.length === 0) {
    return undefined
  }
  const oldest = Math.min(...pending.map((entry) => Date.parse(String(entry.at)) / 1000))
  return oldest + delay - ctx.now().getTime() / 1000
}

/**
 * Wait for this owner's events until one needs action. A merged pull request is checked for
 * unresolved or late review findings; a clean one is logged, the cursor moves past it, and the
 * wait continues. The wait returns on any other event, a merge with findings, a completed watch,
 * a due dependency update check, a gap, or the timeout. It throws `StoppedError` when the stop
 * switch is set at the start or appears between two hook-harness rounds, and `UnadvancedError`
 * when the previous result's events were not advanced.
 */
export async function runWait(ctx: WaitContext, settings: WaitSettings): Promise<void> {
  const total = seconds(settings.timeout)
  const delay = seconds(settings.updateCheckDelay)
  const { advance } = settings
  const started = ctx.now().getTime()
  const idle = { events: [], gap: false }
  let repos: string[] | undefined
  let first = true
  await refuseWhenStopped(ctx.dir, 'supervisor wait')
  await refuseUnadvanced(ctx)
  for (;;) {
    // Before the first round and between rounds: a stop ends the wait without acting.
    await refuseWhenStopped(ctx.dir, 'supervisor wait')
    const remaining = total - (ctx.now().getTime() - started) / 1000
    const waiting = await watchTriggers(ctx.dir)
    if (remaining <= 0) {
      const data = { ...idle, timedOut: true }
      return await emit(ctx, { data, lines: [], triggers: waiting, advance, due: false })
    }
    if (waiting.length > 0) {
      return await emit(ctx, { data: idle, lines: [], triggers: waiting, advance, due: false })
    }
    const until = await pendingDeadline(ctx, delay)
    const due = until !== undefined && until < remaining
    if (due && until <= 0) {
      return await emit(ctx, { data: idle, lines: [], triggers: [], advance, due: true })
    }
    repos ??= await listRepositories(ctx)
    const limit = `${Math.max(Math.trunc(due ? until : remaining), 1)}s`
    const data = await hookHarnessWait(ctx, repos, first && !due ? settings.timeout : limit)
    first = false
    const events = get(data, 'events')
    const received = Array.isArray(events) ? events : []
    const { lines, raw, triggers } = await sweep(received, ctx)
    data.events = raw
    const actionable = lines.length > 0 || triggers.length > 0
    if (received.length === 0 || actionable || data.gap || data.timedOut) {
      const overdue = due && Boolean(data.timedOut)
      return await emit(ctx, { data, lines, triggers, advance, due: overdue })
    }
    await withStateLock(ctx.dir, async () => {
      const state = await loadState(ctx.dir)
      recordEvents(state, ctx.owner, [], get(data, 'cursor') ?? null)
      await saveState(ctx.dir, state)
    })
  }
}
