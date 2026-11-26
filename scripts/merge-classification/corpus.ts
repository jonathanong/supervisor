import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvaluationInput } from '../../src/policy/types.js'

export type Label = 'merge' | 'person'
export type Priority = 'critical' | 'high' | 'medium' | 'low'

export const PRIORITIES: readonly Priority[] = ['critical', 'high', 'medium', 'low']

export interface EvalCase {
  id: string
  /** The carve-out or always-human class the case tests. */
  group: string
  priority: Priority
  description: string
  input: EvaluationInput
  /** Ground truth: what should happen to this PR. */
  label: Label
  reason: string
}

const CASE_KEYS = ['id', 'group', 'priority', 'description', 'input', 'label', 'reason']
const PLAIN_FIELD = /^[a-z0-9-]+$/

function parseCase(raw: unknown, where: string): EvalCase {
  if (typeof raw !== 'object' || raw === null) throw new Error(`${where}: case must be an object`)
  const entry = raw as Record<string, unknown>
  const unknown = Object.keys(entry).filter((key) => !CASE_KEYS.includes(key))
  if (unknown.length > 0) throw new Error(`${where}: unknown keys ${unknown.join(', ')}`)
  for (const key of ['id', 'group', 'description', 'reason']) {
    if (typeof entry[key] !== 'string' || entry[key] === '') {
      throw new Error(`${where}: ${key} must be a non-empty string`)
    }
  }
  for (const key of ['id', 'group']) {
    if (!PLAIN_FIELD.test(entry[key] as string)) {
      throw new Error(`${where}: ${key} must match ${PLAIN_FIELD.source}`)
    }
  }
  if (entry.label !== 'merge' && entry.label !== 'person') {
    throw new Error(`${where}: label must be 'merge' or 'person'`)
  }
  if (!PRIORITIES.includes(entry.priority as Priority)) {
    throw new Error(`${where}: priority must be one of ${PRIORITIES.join(', ')}`)
  }
  // A false merge is the one mistake the next sweep cannot undo.
  if (entry.label === 'person' && entry.priority !== 'critical') {
    throw new Error(`${where}: a case labelled 'person' must have priority 'critical'`)
  }
  const input = entry.input as EvaluationInput | undefined
  if (typeof input !== 'object' || input === null || !Array.isArray(input.changedFiles)) {
    throw new Error(`${where}: input must be an object with a changedFiles array`)
  }
  return entry as unknown as EvalCase
}

/** Reads every `*.json` file in the corpus directory; each holds a list of cases. */
export async function loadCorpus(corpusDir: string): Promise<EvalCase[]> {
  const names = (await readdir(corpusDir)).filter((name) => name.endsWith('.json')).sort()
  const cases: EvalCase[] = []
  const seen = new Set<string>()
  for (const name of names) {
    const raw = JSON.parse(await readFile(join(corpusDir, name), 'utf8')) as unknown
    if (!Array.isArray(raw)) throw new Error(`${name}: corpus file must hold a list of cases`)
    raw.forEach((entry, index) => {
      const parsed = parseCase(entry, `${name}[${index}]`)
      if (seen.has(parsed.id)) throw new Error(`${name}[${index}]: duplicate id '${parsed.id}'`)
      seen.add(parsed.id)
      cases.push(parsed)
    })
  }
  return cases
}
