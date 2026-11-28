import { CORE_PROVENANCE_FIELDS } from '../config/provenance.js'
import { stripCredentials } from './redact.js'
import type { ValidationError } from './validate.js'

export const PROVENANCE_MARKER = '<!-- supervisor:provenance v1 -->'
export const PROVENANCE_ROLES = ['author', 'shepherd', 'reviewer'] as const
export type ProvenanceRole = (typeof PROVENANCE_ROLES)[number]

const ROLE_SET = new Set<string>(PROVENANCE_ROLES)
const CORE_SET = new Set<string>(CORE_PROVENANCE_FIELDS)
const FIELD_LINE_RE = /^- ([a-zA-Z0-9_-]+):(?: (.*))?$/

export interface ProvenanceInput {
  harness: string
  version: string
  models: string[]
  session: string
  role: string
  fields?: Record<string, string>
}

export interface ParsedProvenance {
  harness: string
  version: string
  models: string[]
  session: string
  role: ProvenanceRole
  fields: Record<string, string>
}

export function sanitizeProvenanceInput(input: ProvenanceInput): {
  input: ProvenanceInput
  redacted: boolean
} {
  let redacted = false
  const clean = (value: string): string => {
    const res = stripCredentials(value)
    if (res.redacted) redacted = true
    return res.text
  }
  const fields: Record<string, string> = {}
  if (input.fields !== undefined) {
    for (const [key, value] of Object.entries(input.fields)) {
      fields[key] = clean(value)
    }
  }
  return {
    input: {
      harness: clean(input.harness),
      version: clean(input.version),
      models: input.models.map(clean),
      session: clean(input.session),
      role: clean(input.role),
      ...(input.fields !== undefined ? { fields } : {}),
    },
    redacted,
  }
}

/**
 * Renders one provenance comment in the fixed parseable shape. Extra fields appear in the order
 * configured for the scope, followed by any unexpected keys so validation can report them.
 */
export function renderProvenanceComment(
  input: ProvenanceInput,
  extraFields: readonly string[],
): string {
  const lines = [
    PROVENANCE_MARKER,
    `- harness: ${input.harness}`,
    `- version: ${input.version}`,
    `- models: ${input.models.join(', ')}`,
    `- session: ${input.session}`,
    `- role: ${input.role}`,
  ]
  const provided = input.fields ?? {}
  const emitted = new Set<string>()
  for (const name of extraFields) {
    if (Object.hasOwn(provided, name)) {
      lines.push(`- ${name}: ${provided[name]!}`)
      emitted.add(name)
    }
  }
  for (const [name, value] of Object.entries(provided)) {
    if (!emitted.has(name)) {
      lines.push(`- ${name}: ${value}`)
    }
  }
  return lines.join('\n')
}

function parseModels(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const parts = raw.split(',').map((part) => part.trim())
  return parts.every((part) => part !== '') ? parts : undefined
}

export function validateProvenanceComment(
  comment: string,
  extraFields: readonly string[],
): { parsed?: ParsedProvenance; errors: ValidationError[] } {
  const errors: ValidationError[] = []
  const lines = comment.replace(/\r\n/g, '\n').split('\n')

  if (lines[0] !== PROVENANCE_MARKER) {
    errors.push({
      rule: 'provenance-marker',
      message: `Provenance comment must begin with '${PROVENANCE_MARKER}'.`,
    })
  }

  const values = new Map<string, string>()
  let formatError = false
  for (const line of lines.slice(1)) {
    const match = FIELD_LINE_RE.exec(line)
    if (!match) {
      formatError = true
      continue
    }
    const key = match[1]!
    const value = (match[2] ?? '').trim()
    if (values.has(key)) {
      formatError = true
      continue
    }
    values.set(key, value)
  }
  if (formatError) {
    errors.push({
      rule: 'provenance-format',
      message: 'Every line after the marker must be a unique `- <field>: <value>` entry.',
    })
  }

  const harness = values.get('harness') ?? ''
  if (harness === '') {
    errors.push({ rule: 'provenance-harness', message: 'Provenance `harness` must be non-empty.' })
  }
  const version = values.get('version') ?? ''
  if (version === '') {
    errors.push({ rule: 'provenance-version', message: 'Provenance `version` must be non-empty.' })
  }
  const models = parseModels(values.get('models'))
  if (models === undefined) {
    errors.push({
      rule: 'provenance-models',
      message: 'Provenance `models` must list one or more comma-separated model names.',
    })
  }
  const session = values.get('session') ?? ''
  if (session === '') {
    errors.push({ rule: 'provenance-session', message: 'Provenance `session` must be non-empty.' })
  }
  const role = values.get('role') ?? ''
  if (!ROLE_SET.has(role)) {
    errors.push({
      rule: 'provenance-role',
      message: `Provenance \`role\` must be one of: ${PROVENANCE_ROLES.join(', ')}.`,
    })
  }

  const expectedExtra = new Set(extraFields)
  const missingExtra = extraFields.filter((name) => (values.get(name) ?? '') === '')
  const unexpectedExtra = [...values.keys()].filter(
    (name) => !CORE_SET.has(name) && !expectedExtra.has(name),
  )
  if (missingExtra.length > 0 || unexpectedExtra.length > 0) {
    const parts: string[] = []
    if (missingExtra.length > 0) parts.push(`missing required fields: ${missingExtra.join(', ')}`)
    if (unexpectedExtra.length > 0) {
      parts.push(`unconfigured fields: ${unexpectedExtra.join(', ')}`)
    }
    errors.push({
      rule: 'provenance-scope-fields',
      message: `Provenance scope fields mismatch (${parts.join('; ')}).`,
    })
  }

  if (errors.length > 0) return { errors }

  const fields: Record<string, string> = {}
  for (const name of extraFields) {
    fields[name] = values.get(name)!
  }
  return {
    parsed: {
      harness,
      version,
      models: models!,
      session,
      role: role as ProvenanceRole,
      fields,
    },
    errors,
  }
}
