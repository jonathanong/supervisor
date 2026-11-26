import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { FLAG, need, REPOSITORY, TEXT, UsageError, type StateContext } from './context.js'
import { dumpsIndented, get, isObject, put, type Json, type JsonObject } from './json.js'
import {
  arrayField,
  expectArray,
  expectObject,
  loadState,
  objectField,
  parseJson,
  saveState,
  StateError,
} from './store.js'

export async function route(args: string[], ctx: StateContext): Promise<void> {
  const options = { what: TEXT, to: TEXT, evidence: TEXT, issue: TEXT, note: TEXT }
  const { values } = parseArgs({ args, options })
  const entry: JsonObject = {
    what: need(values.what, 'what'),
    to: need(values.to, 'to'),
    at: ctx.now(),
  }
  for (const key of ['evidence', 'issue', 'note'] as const) {
    if (values[key]) {
      entry[key] = values[key]
    }
  }
  const state = await loadState(ctx.dir)
  arrayField(state, 'routed').push(entry)
  await saveState(ctx.dir, state)
  ctx.print(entry)
}

export async function annotateRoute(args: string[], ctx: StateContext): Promise<void> {
  const { values } = parseArgs({ args, options: { match: TEXT, note: TEXT, issue: TEXT } })
  const match = need(values.match, 'match')
  const note = need(values.note, 'note')
  const state = await loadState(ctx.dir)
  const routed = expectArray(get(state, 'routed') ?? [], 'routed')
  const hits = routed.filter(
    (entry): entry is JsonObject =>
      isObject(entry) && typeof entry.what === 'string' && entry.what.includes(match),
  )
  const hit = hits[0]
  if (hit === undefined || hits.length !== 1) {
    throw new StateError(`annotate-route: ${hits.length} entries match '${match}'; need exactly 1`)
  }
  hit.note = note
  if (values.issue) {
    hit.issue = values.issue
  }
  await saveState(ctx.dir, state)
  ctx.print(hit)
}

export async function scheduledPromptRecord(args: string[], ctx: StateContext): Promise<void> {
  const options = { prompt: TEXT, 'run-id': TEXT, outcome: TEXT, next: TEXT, pr: TEXT }
  const { values } = parseArgs({ args, options })
  const entry: JsonObject = {
    prompt: need(values.prompt, 'prompt'),
    runId: need(values['run-id'], 'run-id'),
    at: ctx.now(),
    outcome: need(values.outcome, 'outcome'),
  }
  const next = need(values.next, 'next')
  if (values.pr) {
    entry.pr = values.pr
  }
  const state = await loadState(ctx.dir)
  const prompts = objectField(state, 'scheduledPrompts')
  const runs = arrayField(prompts, 'runs', 'scheduledPrompts.runs')
  runs.push(entry)
  prompts.runs = runs.slice(-ctx.history)
  prompts.next = next
  await saveState(ctx.dir, state)
  ctx.print({ recorded: entry, next })
}

export async function scheduledPromptNext(args: string[], ctx: StateContext): Promise<void> {
  const { values } = parseArgs({ args, options: { next: TEXT } })
  const next = need(values.next, 'next')
  const state = await loadState(ctx.dir)
  objectField(state, 'scheduledPrompts').next = next
  await saveState(ctx.dir, state)
  ctx.print({ next })
}

export async function shepherd(args: string[], ctx: StateContext): Promise<void> {
  const options = { pr: TEXT, remove: FLAG, by: TEXT, head: TEXT, category: TEXT }
  const { values } = parseArgs({ args, options })
  const pr = need(values.pr, 'pr')
  const state = await loadState(ctx.dir)
  const shepherds = objectField(state, 'shepherds')
  if (values.remove) {
    delete shepherds[pr]
  } else {
    put(shepherds, pr, {
      by: values.by ?? 'loop subagent',
      since: ctx.now(),
      head: values.head ?? null,
      category: values.category ?? null,
    })
  }
  await saveState(ctx.dir, state)
  ctx.print({ [pr]: get(shepherds, pr) ?? null })
}

export async function sweepDone(args: string[], ctx: StateContext): Promise<void> {
  parseArgs({ args, options: {} })
  const state = await loadState(ctx.dir)
  const lastSweepAt = ctx.now()
  state.lastSweepAt = lastSweepAt
  delete state.sweep
  await saveState(ctx.dir, state)
  ctx.print({ lastSweepAt })
}

function commentId(value: Json): number {
  const id = Math.trunc(Number(isObject(value) ? value.id : value))
  if (value === null || !Number.isFinite(id)) {
    throw new StateError(`reviewed: ${JSON.stringify(value)} is not a comment id`)
  }
  return id
}

/** Add harvested comment ids from a `{"<owner>/<repo>": [ids]}` file, skipping known ones. */
export async function reviewed(args: string[], ctx: StateContext): Promise<void> {
  const { values } = parseArgs({ args, options: { file: TEXT } })
  const file = need(values.file, 'file')
  const state = await loadState(ctx.dir)
  const comments = objectField(state, 'reviewedComments')
  const added = expectObject(parseJson(await readFile(file, 'utf8'), file), 'reviewed --file')
  for (const [repository, ids] of Object.entries(added)) {
    if (!REPOSITORY.test(repository)) {
      throw new StateError(`reviewed: '${repository}' must look like owner/repo`)
    }
    const current = arrayField(comments, repository, `reviewedComments.${repository}`)
    const have = new Set(current.map(commentId))
    for (const id of expectArray(ids, `reviewed --file ${repository}`).map(commentId)) {
      if (!have.has(id)) {
        current.push({ id, harvestedAt: ctx.now() })
        have.add(id)
      }
    }
  }
  await saveState(ctx.dir, state)
  const counts: JsonObject = {}
  for (const [repository, ids] of Object.entries(comments)) {
    put(counts, repository, expectArray(ids, `reviewedComments.${repository}`).length)
  }
  ctx.print(counts)
}

export async function show(args: string[], ctx: StateContext): Promise<void> {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true })
  if (positionals.length > 1) {
    throw new UsageError(`unexpected arguments: ${positionals.slice(1).join(' ')}`)
  }
  const state = await loadState(ctx.dir)
  const key = positionals[0]
  const value = key === undefined ? Object.keys(state).sort() : (get(state, key) ?? null)
  ctx.write(`${dumpsIndented(value)}\n`)
}
