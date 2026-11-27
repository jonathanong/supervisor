import { readFile } from 'node:fs/promises'
import { lastWaitPath } from '../state/hook-harness.js'
import { get, isObject, type Json, type JsonObject } from '../state/json.js'
import { loadState, parseJson } from '../state/store.js'
import type { WaitContext } from './context.js'

/** The exit code of a wait that refused to start over events that were not advanced. */
export const UNADVANCED_EXIT = 4

/** The previous result still holds events that `supervisor state advance-hh` has not recorded. */
export class UnadvancedError extends Error {
  constructor(owner: string) {
    super(
      `supervisor wait: hh-last.${owner}.json holds events that were not advanced; ` +
        `run "supervisor state advance-hh --owner ${owner}" first`,
    )
  }
}

/** The event ids stored as seen for one owner. */
export function seenIds(state: JsonObject, owner: string): Json[] {
  const harness = get(state, 'hookHarness')
  const mine = isObject(harness) ? get(harness, owner) : undefined
  return isObject(mine) && Array.isArray(mine.seen) ? mine.seen : []
}

/**
 * Refuse to start when the previous result file holds an event whose id is not in
 * `hookHarness.<owner>.seen`. `advance-hh` marks every id in the file seen and stores the cursor in
 * one write, and a wait that advances itself does the same at return, so a missing id means the
 * events were not advanced and a new wait from the stored cursor would return them again. The
 * cursor is not compared: a result with no events, or one the cursor already moved past, is fine.
 */
export async function refuseUnadvanced(ctx: WaitContext): Promise<void> {
  const path = lastWaitPath(ctx.dir, ctx.owner)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
  const last = parseJson(text, path)
  const events = isObject(last) ? get(last, 'events') : undefined
  const seen = seenIds(await loadState(ctx.dir), ctx.owner)
  const ids = (Array.isArray(events) ? events : []).filter(isObject).map((event) => event.id)
  if (ids.some((id) => id !== undefined && !seen.includes(id))) {
    throw new UnadvancedError(ctx.owner)
  }
}
