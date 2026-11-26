import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { FLAG, NAME, need, TEXT, TEXTS, UsageError, type StateContext } from './context.js'
import { lastWaitPath, recordEvents } from './hook-harness.js'
import { get, isObject, type Json } from './json.js'
import { checkLateReview, LateReviewError, lateReviewLine } from './late-review.js'
import { expectArray, expectObject, loadState, parseJson, saveState } from './store.js'
import { updateCheckScript } from './update-check.js'

/** Store the cursor and the seen event ids from one owner's last wait result. */
export async function advanceHookHarness(args: string[], ctx: StateContext): Promise<void> {
  const { values } = parseArgs({ args, options: { owner: TEXT } })
  const owner = need(values.owner, 'owner')
  if (!NAME.test(owner)) {
    throw new UsageError(`--owner: '${owner}' is not a valid owner name`)
  }
  const state = await loadState(ctx.dir)
  const path = lastWaitPath(ctx.dir, owner)
  const last = expectObject(parseJson(await readFile(path, 'utf8'), path), path)
  const ids: Json[] = []
  for (const event of expectArray(get(last, 'events') ?? [], `${path} events`)) {
    if (isObject(event) && event.id !== undefined) {
      ids.push(event.id)
    }
  }
  const cursor = get(last, 'cursor') ?? null
  recordEvents(state, owner, ids, cursor)
  await saveState(ctx.dir, state)
  ctx.print({ events: ids.length, cursorAdvanced: Boolean(cursor) })
}

/** Print one line per merged pull request; exit 1 when any of them could not be checked. */
export async function lateReview(args: string[], ctx: StateContext): Promise<number> {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true })
  if (positionals.length === 0) {
    throw new UsageError('late-review needs at least one owner/repo#N')
  }
  let failed = false
  for (const ref of positionals) {
    try {
      ctx.write(`${lateReviewLine(await checkLateReview(ctx.run, ref))}\n`)
    } catch (error) {
      if (!(error instanceof LateReviewError)) {
        throw error
      }
      failed = true
      ctx.write(`${ref} error: ${error.message}\n`)
    }
  }
  return failed ? 1 : 0
}

export function updateCheck(args: string[], ctx: StateContext): void {
  const { values } = parseArgs({ args, options: { repo: TEXTS, owner: TEXT, dry: FLAG } })
  if (values.repo === undefined) {
    throw new UsageError('--repo is required')
  }
  const owner = values.owner ?? (ctx.owners.length === 1 ? ctx.owners[0] : undefined)
  if (owner === undefined) {
    throw new UsageError('--owner is required when the config has more than one owner')
  }
  ctx.write(updateCheckScript(owner, values.repo, values.dry === true))
}
