import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { isPlainObject } from './locals.js'
import { PolicyLoadError, type PolicyValidationError } from './types.js'
import { checkAllowedKeys } from './validate-parts.js'

/** One named answer a classifier gives, and the values it may take. */
export type ClassifierOutput =
  | { type: 'criteria' | 'ordinal'; values: string[] }
  | { type: 'numeric'; min: number; max: number }

export interface ClassifierDef {
  description: string
  /** The model the definition asks for; the skill passes it on as a hint. */
  model: string
  prompt: string
  outputs: Record<string, ClassifierOutput>
}

const KEYS = new Set(['version', 'description', 'model', 'prompt', 'outputs'])
/** Claude Approvals keys this loader does not run: a definition that sets one has no result. */
const UNSUPPORTED = ['inputs', 'tools', 'budget']
const NAME = /^[A-Za-z0-9_-]+$/

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
}

function parseOutput(
  raw: unknown,
  path: string,
  file: string,
  errors: PolicyValidationError[],
): ClassifierOutput | undefined {
  const fail = (message: string): undefined => {
    errors.push({ file, path, message })
    return undefined
  }
  if (!NAME.test(path.slice('outputs.'.length))) return fail('The name must be a plain word')
  if (!isPlainObject(raw)) return fail('An output must be a mapping with a type')
  if (raw.type === 'numeric') {
    checkAllowedKeys(raw, new Set(['type', 'min', 'max']), path, file, errors)
    const { min, max } = raw
    if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) > (max as number)) {
      return fail('A numeric output needs integers min and max, with min not above max')
    }
    return { type: 'numeric', min: min as number, max: max as number }
  }
  if (raw.type !== 'criteria' && raw.type !== 'ordinal') {
    return fail('type must be criteria, ordinal or numeric')
  }
  checkAllowedKeys(raw, new Set(['type', 'values']), path, file, errors)
  const { values } = raw
  const words = Array.isArray(values) && values.every((v) => typeof v === 'string' && v !== '')
  if (!words || values.length === 0 || new Set(values).size !== values.length) {
    return fail('values must be a list of distinct, non-empty words')
  }
  return { type: raw.type, values: values as string[] }
}

function parseDef(source: string, promptFile: string | undefined, file: string): ClassifierDef {
  const errors: PolicyValidationError[] = []
  const doc = parseDocument(source, { uniqueKeys: true })
  if (doc.errors.length > 0) {
    throw new PolicyLoadError(doc.errors.map((err) => ({ file, path: '$', message: err.message })))
  }
  const root = doc.toJS()
  if (!isPlainObject(root)) {
    throw new PolicyLoadError([{ file, path: '$', message: 'A definition must be a YAML mapping' }])
  }
  for (const key of UNSUPPORTED.filter((name) => name in root)) {
    const message = `'${key}' is not supported: the supervisor runs no classifier that sets it`
    errors.push({ file, path: key, message })
  }
  checkAllowedKeys(root, new Set([...KEYS, ...UNSUPPORTED]), '', file, errors)
  if (root.version !== 1) errors.push({ file, path: 'version', message: 'version must be 1' })
  for (const key of ['description', 'model'] as const) {
    if (typeof root[key] !== 'string' || root[key] === '') {
      errors.push({ file, path: key, message: `${key} is required and must be a string` })
    }
  }
  if ((root.prompt !== undefined) === (promptFile !== undefined)) {
    errors.push({ file, path: 'prompt', message: 'Set exactly one of prompt and prompt.md' })
  } else if (root.prompt !== undefined && typeof root.prompt !== 'string') {
    errors.push({ file, path: 'prompt', message: 'prompt must be a string' })
  }
  const outputs: Record<string, ClassifierOutput> = {}
  const named = isPlainObject(root.outputs) ? Object.entries(root.outputs) : []
  if (named.length === 0) errors.push({ file, path: 'outputs', message: 'outputs must name one' })
  for (const [name, value] of named) {
    const output = parseOutput(value, `outputs.${name}`, file, errors)
    if (output) outputs[name] = output
  }
  if (errors.length > 0) throw new PolicyLoadError(errors)
  return {
    description: root.description as string,
    model: root.model as string,
    prompt: (root.prompt ?? promptFile) as string,
    outputs,
  }
}

/**
 * Loads `<classifiers>/<name>/def.yml` (or `def.yaml`) and its optional `prompt.md`.
 * Throws a PolicyLoadError for a missing, doubled or invalid definition.
 */
export async function loadClassifierDef(classifiers: string, name: string): Promise<ClassifierDef> {
  const dir = join(classifiers, name)
  if (!NAME.test(name)) {
    throw new PolicyLoadError([{ file: dir, path: '$', message: 'The name must be a plain word' }])
  }
  const [yml, yaml] = await Promise.all(
    ['def.yml', 'def.yaml'].map((file) => readIfPresent(join(dir, file))),
  )
  const file = join(dir, yml === undefined ? 'def.yaml' : 'def.yml')
  const fail = (message: string): never => {
    throw new PolicyLoadError([{ file, path: '$', message }])
  }
  if (yml !== undefined && yaml !== undefined) fail('Both def.yml and def.yaml exist')
  const source = yml ?? yaml ?? fail('No def.yml or def.yaml')
  return parseDef(source, await readIfPresent(join(dir, 'prompt.md')), file)
}
