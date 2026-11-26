import { parseArgs } from 'node:util'
import { need, TEXT, UsageError, type StateContext } from './context.js'
import { isObject } from './json.js'
import { loadState, saveState, StateError } from './store.js'

/** A sweep that has not finished after this long is taken to have crashed. */
const DEFAULT_TTL_MINUTES = 120

/**
 * Claim the one sweep that may run at a time. `supervisor state` holds the state lock for one
 * update only, so a sweep records itself in `sweep` and every other sweep refuses to start until
 * `sweep-done` clears it or the claim is older than the limit. The same id may claim again.
 */
export async function sweepStart(args: string[], ctx: StateContext): Promise<void> {
  const { values } = parseArgs({ args, options: { id: TEXT, 'ttl-minutes': TEXT } })
  const id = need(values.id, 'id')
  const ttl = Number(values['ttl-minutes'] ?? DEFAULT_TTL_MINUTES)
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new UsageError('--ttl-minutes must be a positive number')
  }
  const state = await loadState(ctx.dir)
  const startedAt = ctx.now()
  const held = state.sweep
  if (isObject(held) && held.id !== id && typeof held.startedAt === 'string') {
    const ageMinutes = (Date.parse(startedAt) - Date.parse(held.startedAt)) / 60_000
    if (ageMinutes < ttl) {
      throw new StateError(
        `sweep ${JSON.stringify(held.id)} started at ${held.startedAt} is still running; skip this sweep`,
      )
    }
  }
  const sweep = { id, startedAt }
  state.sweep = sweep
  await saveState(ctx.dir, state)
  ctx.print({ sweep })
}
