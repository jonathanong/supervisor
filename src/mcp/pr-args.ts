import { PULL_NUMBER, REPOSITORY } from '../policy/facts-gh.js'
import { PrToolError } from '../pr/gh-client.js'
import type { ProvenanceInput } from '../pr/provenance.js'
import { isObject } from '../state/json.js'

const VALIDATE_ARGS = new Set(['repository', 'title', 'body', 'provenance', 'provenanceComment'])
const CREATE_ARGS = new Set([
  'repository',
  'head',
  'base',
  'title',
  'body',
  'draft',
  'issue',
  'provenance',
])
const UPDATE_ARGS = new Set(['repository', 'pr', 'title', 'body', 'issue', 'provenance'])
const PROVENANCE_KEYS = new Set(['harness', 'version', 'models', 'session', 'role', 'fields'])

function checkAllowedKeys(raw: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key))
  if (unknown.length > 0) throw invalid(`Unknown argument: ${unknown.join(', ')}.`)
}

function invalid(message: string): PrToolError {
  return new PrToolError('invalid-argument', message)
}

function requireRepository(value: unknown): string {
  if (typeof value !== 'string') throw invalid('repository must be a string.')
  if (!REPOSITORY.test(value)) {
    throw invalid(`'${value}' must look like <owner>/<repo>.`)
  }
  return value
}

function requirePositiveInt(value: unknown, name: string): number {
  if (typeof value !== 'number') throw invalid(`${name} must be an integer.`)
  if (!Number.isSafeInteger(value) || !PULL_NUMBER.test(String(value))) {
    throw invalid(`'${value}' must be a positive integer for ${name}.`)
  }
  return value
}

function requireSingleLine(value: unknown, name: string): string {
  if (typeof value !== 'string') throw invalid(`${name} must be a string.`)
  if (/[\r\n]/.test(value)) throw invalid(`${name} must be a single line.`)
  return value
}

function parseProvenanceArg(raw: unknown): ProvenanceInput {
  if (!isObject(raw)) throw invalid('provenance must be an object.')
  const unknown = Object.keys(raw).filter((key) => !PROVENANCE_KEYS.has(key))
  if (unknown.length > 0) {
    throw invalid(`Unknown provenance argument: ${unknown.join(', ')}.`)
  }
  const harness = requireSingleLine(raw.harness, 'provenance.harness')
  const version = requireSingleLine(raw.version, 'provenance.version')
  if (
    !Array.isArray(raw.models) ||
    !raw.models.every((item): item is string => typeof item === 'string' && !/[\r\n]/.test(item))
  ) {
    throw invalid('provenance.models must be an array of single-line strings.')
  }
  const session = requireSingleLine(raw.session, 'provenance.session')
  const role = requireSingleLine(raw.role, 'provenance.role')
  let fields: Record<string, string> | undefined
  if (raw.fields !== undefined) {
    if (!isObject(raw.fields)) throw invalid('provenance.fields must be an object.')
    fields = {}
    for (const [key, value] of Object.entries(raw.fields)) {
      if (/[\r\n]/.test(key)) throw invalid('provenance.fields keys must be single-line.')
      fields[key] = requireSingleLine(value, `provenance.fields.${key}`)
    }
  }
  return {
    harness,
    version,
    models: raw.models,
    session,
    role,
    ...(fields !== undefined ? { fields } : {}),
  }
}

export interface PrValidateArgs {
  repository: string
  title: string
  body: string
  provenance?: ProvenanceInput
  provenanceComment?: string
}

export function parsePrValidateArgs(raw: Record<string, unknown>): PrValidateArgs {
  checkAllowedKeys(raw, VALIDATE_ARGS)
  const repository = requireRepository(raw.repository)
  if (typeof raw.title !== 'string') throw invalid('title must be a string.')
  if (typeof raw.body !== 'string') throw invalid('body must be a string.')
  const hasStructured = raw.provenance !== undefined
  const hasComment = raw.provenanceComment !== undefined
  if (hasStructured === hasComment) {
    throw invalid('Provide exactly one of provenance or provenanceComment.')
  }
  if (hasComment) {
    if (typeof raw.provenanceComment !== 'string') {
      throw invalid('provenanceComment must be a string.')
    }
    return {
      repository,
      title: raw.title,
      body: raw.body,
      provenanceComment: raw.provenanceComment,
    }
  }
  return {
    repository,
    title: raw.title,
    body: raw.body,
    provenance: parseProvenanceArg(raw.provenance),
  }
}

export interface PrCreateArgs {
  repository: string
  head: string
  base?: string
  title: string
  body: string
  draft: boolean
  issue?: number
  provenance: ProvenanceInput
}

export function parsePrCreateArgs(raw: Record<string, unknown>): PrCreateArgs {
  checkAllowedKeys(raw, CREATE_ARGS)
  const repository = requireRepository(raw.repository)
  if (typeof raw.head !== 'string' || raw.head.trim() === '') {
    throw invalid('head must be a non-empty string.')
  }
  if (raw.base !== undefined && (typeof raw.base !== 'string' || raw.base.trim() === '')) {
    throw invalid('base must be a non-empty string.')
  }
  if (typeof raw.title !== 'string') throw invalid('title must be a string.')
  if (typeof raw.body !== 'string') throw invalid('body must be a string.')
  if (raw.draft !== undefined && typeof raw.draft !== 'boolean') {
    throw invalid('draft must be a boolean.')
  }
  const issue = raw.issue !== undefined ? requirePositiveInt(raw.issue, 'issue') : undefined
  return {
    repository,
    head: raw.head.trim(),
    ...(raw.base !== undefined ? { base: raw.base.trim() } : {}),
    title: raw.title,
    body: raw.body,
    draft: raw.draft ?? false,
    ...(issue !== undefined ? { issue } : {}),
    provenance: parseProvenanceArg(raw.provenance),
  }
}

export interface PrUpdateArgs {
  repository: string
  pr: number
  title?: string
  body?: string
  issue?: number
  provenance: ProvenanceInput
}

export function parsePrUpdateArgs(raw: Record<string, unknown>): PrUpdateArgs {
  checkAllowedKeys(raw, UPDATE_ARGS)
  const repository = requireRepository(raw.repository)
  const pr = requirePositiveInt(raw.pr, 'pr')
  if (raw.title !== undefined && typeof raw.title !== 'string') {
    throw invalid('title must be a string.')
  }
  if (raw.body !== undefined && typeof raw.body !== 'string') {
    throw invalid('body must be a string.')
  }
  const issue = raw.issue !== undefined ? requirePositiveInt(raw.issue, 'issue') : undefined
  return {
    repository,
    pr,
    ...(raw.title !== undefined ? { title: raw.title } : {}),
    ...(raw.body !== undefined ? { body: raw.body } : {}),
    ...(issue !== undefined ? { issue } : {}),
    provenance: parseProvenanceArg(raw.provenance),
  }
}
