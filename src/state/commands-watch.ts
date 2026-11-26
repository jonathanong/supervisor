import { parseArgs } from 'node:util'
import { TEXT, TEXTS, UsageError, type StateContext } from './context.js'
import { isObject, type Json, type JsonObject } from './json.js'
import { isMerged, LateReviewError, PULL_REF } from './late-review.js'
import type { RunProcess } from './process.js'
import { arrayField, loadState, saveState, StateError } from './store.js'

const ACTIONS = ['add', 'list', 'ack', 'remove']

function hasId(id: string | undefined) {
  return (watch: Json): watch is JsonObject => isObject(watch) && watch.id === id
}

async function mergedAmong(run: RunProcess, refs: string[]): Promise<string[]> {
  const merged: string[] = []
  try {
    for (const ref of refs) {
      if (await isMerged(run, ref)) {
        merged.push(ref.toLowerCase())
      }
    }
  } catch (error) {
    if (!(error instanceof LateReviewError)) {
      throw error
    }
    throw new StateError(`watch add: ${error.message}`)
  }
  return merged.sort()
}

/** Add, list, acknowledge, or remove a merge watch; every action prints the watches. */
export async function watch(args: string[], ctx: StateContext): Promise<void> {
  const options = { id: TEXT, pr: TEXTS, notify: TEXT, note: TEXT }
  const { values, positionals } = parseArgs({ args, options, allowPositionals: true })
  const action = positionals[0]
  if (positionals.length !== 1 || !ACTIONS.includes(action!)) {
    throw new UsageError(`watch needs one action: ${ACTIONS.join(', ')}`)
  }
  const state = await loadState(ctx.dir)
  const watches = arrayField(state, 'watches')
  if (action === 'add') {
    const prs = values.pr ?? []
    if (!values.id || prs.length === 0 || !values.notify) {
      throw new StateError('watch add needs --id, --notify, and at least one --pr')
    }
    if (watches.some(hasId(values.id))) {
      throw new StateError(`watch add: '${values.id}' already exists`)
    }
    const malformed = prs.find((ref) => !PULL_REF.test(ref))
    if (malformed !== undefined) {
      throw new StateError(`watch add: '${malformed}' must look like owner/repo#N`)
    }
    watches.push({
      id: values.id,
      prs,
      notify: values.notify,
      note: values.note ?? '',
      at: ctx.now(),
      merged: await mergedAmong(ctx.run, prs),
    })
  } else if (action === 'remove') {
    state.watches = watches.filter((entry) => !hasId(values.id)(entry))
  } else if (action === 'ack') {
    const hit = watches.find(hasId(values.id))
    if (hit === undefined) {
      throw new StateError(`watch ack: no watch '${values.id}'`)
    }
    hit.ackedAt = ctx.now()
  }
  if (action !== 'list') {
    await saveState(ctx.dir, state)
  }
  ctx.print(state.watches!)
}
