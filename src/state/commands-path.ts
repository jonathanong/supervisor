import { parseArgs } from 'node:util'
import { need, TEXT, UsageError, type StateContext } from './context.js'
import { get, put, type JsonObject } from './json.js'
import {
  arrayField,
  expectKind,
  expectObject,
  FIELDS,
  loadState,
  parseJson,
  saveState,
  StateError,
} from './store.js'

function parsePath(path: string | undefined): { path: string; keys: string[]; last: string } {
  if (path === undefined) {
    throw new UsageError('a dotted path is required')
  }
  const keys = path.split('.')
  if (!Object.hasOwn(FIELDS, keys[0]!) || !keys.every(Boolean)) {
    const known = Object.keys(FIELDS).sort().join(', ')
    throw new StateError(`supervisor state: '${path}' must start with one of ${known}`)
  }
  return { path, keys, last: keys.at(-1)! }
}

/** The object that holds the last key of a dotted path; `create` makes the missing ones. */
function parentOf(state: JsonObject, keys: string[], create: boolean): JsonObject {
  let node = state
  keys.slice(0, -1).forEach((key, depth) => {
    const kind = depth === 0 ? FIELDS[key]! : 'object'
    if (create && !Object.hasOwn(node, key)) {
      put(node, key, kind === 'array' ? [] : {})
    }
    const name = keys.slice(0, depth + 1).join('.')
    expectKind(get(node, key), kind, name)
    node = expectObject(get(node, key), name)
  })
  return node
}

function onePath(args: string[], options: Record<string, typeof TEXT>) {
  const { values, positionals } = parseArgs({ args, options, allowPositionals: true })
  if (positionals.length > 1) {
    throw new UsageError(`unexpected arguments: ${positionals.slice(1).join(' ')}`)
  }
  return { values, ...parsePath(positionals[0]) }
}

/** `mergeRecords` is written only by `merge-record`, which checks what it stores. */
function checked(keys: string[]): string[] {
  if (keys[0] === 'mergeRecords') {
    throw new StateError(
      'supervisor state: mergeRecords is written only by "supervisor state merge-record"',
    )
  }
  return keys
}

export async function setValue(args: string[], ctx: StateContext): Promise<void> {
  const { values, path, keys, last } = onePath(args, { json: TEXT })
  const value = parseJson(need(values.json, 'json'), '--json')
  if (keys.length === 1) {
    expectKind(value, FIELDS[last]!, last)
  }
  const state = await loadState(ctx.dir)
  put(parentOf(state, checked(keys), true), last, value)
  await saveState(ctx.dir, state)
  ctx.print({ [path]: value })
}

export async function appendValue(args: string[], ctx: StateContext): Promise<void> {
  const { values, path, keys, last } = onePath(args, { json: TEXT, keep: TEXT })
  const value = parseJson(need(values.json, 'json'), '--json')
  if (values.keep !== undefined && !/^-?\d+$/.test(values.keep)) {
    throw new UsageError(`--keep: invalid integer '${values.keep}'`)
  }
  const keep = Number(values.keep ?? 0)
  const state = await loadState(ctx.dir)
  const parent = parentOf(state, checked(keys), true)
  const items = arrayField(parent, last, path)
  items.push(value)
  const kept = keep === 0 ? items : items.slice(-keep)
  put(parent, last, kept)
  await saveState(ctx.dir, state)
  ctx.print({ [path]: kept.length })
}

export async function removeValue(args: string[], ctx: StateContext): Promise<void> {
  const { path, keys, last } = onePath(args, {})
  const state = await loadState(ctx.dir)
  let removed = false
  if (Object.hasOwn(state, keys[0]!)) {
    const parent = parentOf(state, keys, false)
    // A key that holds null is deleted but reported as absent, as it always has been.
    removed = (get(parent, last) ?? null) !== null
    delete parent[last]
  }
  await saveState(ctx.dir, state)
  ctx.print({ [path]: removed ? 'removed' : 'absent' })
}
