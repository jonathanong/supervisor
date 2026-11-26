import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { allowsMerge, classifyCase, summarize } from '../scripts/merge-classification/classify.js'
import { loadCorpus } from '../scripts/merge-classification/corpus.js'
import {
  CORPUS_DIR,
  CSV_PATH,
  README_PATH,
  loadReferencePolicy,
} from '../scripts/merge-classification/main.js'
import {
  formatReadmeBlock,
  parseCsv,
  replaceReadmeBlock,
} from '../scripts/merge-classification/report.js'
import { evaluatePolicies } from '../src/policy/evaluate.js'
import type { PolicyFile } from '../src/policy/types.js'

/** Cases whose evaluator answer differs from their label. Each needs a reason in evals/EVALS.md. */
const KNOWN_MISSED_MERGES = ['docs-06']

interface Variant {
  name: string
  policies: PolicyFile[]
}

/** Every policy that differs from the reference by one removed rule, override, or path pattern. */
function ablations(policies: PolicyFile[]): Variant[] {
  const variants: Variant[] = []
  policies.forEach((policy, p) => {
    policy.rules.forEach((rule, r) => {
      const edit = (name: string, change: (copy: PolicyFile) => void) => {
        const copy = structuredClone(policies)
        change(copy[p]!)
        variants.push({ name: `${policy.path} rule '${rule.purpose}': ${name}`, policies: copy })
      }
      edit('rule removed', (file) => file.rules.splice(r, 1))
      rule.override.forEach((_, o) => {
        edit(`override ${o} removed`, (file) => file.rules[r]!.override.splice(o, 1))
      })
      rule.paths.forEach((pattern, i) => {
        const rest = rule.paths.filter((_, j) => j !== i)
        if (rest.every((other) => other.startsWith('!'))) return
        edit(`path ${pattern} removed`, (file) => file.rules[r]!.paths.splice(i, 1))
      })
    })
  })
  return variants
}

describe('merge-classification eval', () => {
  it('has at least 40 cases, most of them labelled person', async () => {
    const corpus = await loadCorpus(CORPUS_DIR)
    const person = corpus.filter((c) => c.label === 'person').length

    expect(corpus.length).toBeGreaterThanOrEqual(40)
    expect(person).toBeGreaterThan(corpus.length / 2)
  })

  it('merges no PR that is labelled person', async () => {
    const policies = await loadReferencePolicy()
    const corpus = await loadCorpus(CORPUS_DIR)

    const summary = summarize(corpus.map((c) => classifyCase(policies, c)))

    expect(summary.falseMerges).toEqual([])
    expect(summary.missedMerges).toEqual(KNOWN_MISSED_MERGES)
  })

  it('sends a comments verdict to a person even when every seat is filled', async () => {
    const policies = await loadReferencePolicy()
    const corpus = await loadCorpus(CORPUS_DIR)
    const approvedByPerson = corpus.find((c) => c.id === 'human-04')!

    const result = evaluatePolicies(policies, approvedByPerson.input)

    expect(result.verdict).toBe('comments')
    expect(result.seats.every((seat) => seat.remaining === 0)).toBe(true)
    expect(result.nextStep.action).toBe('escalate')
    expect(allowsMerge(result)).toBe(false)
  })

  it('has a case that changes outcome for every rule, override, and path pattern', async () => {
    const policies = await loadReferencePolicy()
    const corpus = await loadCorpus(CORPUS_DIR)
    const outcomes = (set: PolicyFile[]) => corpus.map((c) => classifyCase(set, c).actual).join()
    const reference = outcomes(policies)

    const unguarded = ablations(policies)
      .filter((variant) => outcomes(variant.policies) === reference)
      .map((variant) => variant.name)

    expect(unguarded).toEqual([])
  })

  it('keeps cases.csv and the README results in step with the corpus', async () => {
    const policies = await loadReferencePolicy()
    const corpus = await loadCorpus(CORPUS_DIR)
    const rows = parseCsv(await readFile(CSV_PATH, 'utf8'))
    const readme = await readFile(README_PATH, 'utf8')

    const expected = corpus.map((c) => {
      const { actual } = classifyCase(policies, c)
      return [c.id, c.group, c.priority, c.label, actual].join()
    })

    expect(rows.map((r) => [r.case, r.group, r.priority, r.label, r.actual].join())).toEqual(
      expected,
    )
    expect(replaceReadmeBlock(readme, formatReadmeBlock(rows))).toBe(readme)
  })
})
