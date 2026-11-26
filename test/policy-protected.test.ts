import { describe, expect, it } from 'vitest'
import { evaluatePolicies } from '../src/policy/evaluate.js'
import { parsePolicySource } from '../src/policy/load.js'
import { isProtectedPath } from '../src/policy/protected.js'
import type { EvaluationFacts } from '../src/policy/types.js'

const policy = parsePolicySource(`
version: 1
rules:
  - purpose: Source merges with nobody asked
    paths: ['src/**']
    verdict: { claude: approves, seats: 0 }
  - purpose: Library waits for a review
    paths: ['lib/**']
    verdict: { claude: comments, seats: 1 }
    override:
      - { if: 'claude/code_review = pass', verdict: { claude: approves, seats: 0 } }
  - purpose: Large changes to the nested policy merge
    paths: ['packages/app/.claude/**']
    if: 'pr/files_changed > 10'
    verdict: { claude: approves, seats: 0 }
`)
const author: EvaluationFacts = { openedBy: 'example-dev', authors: ['example-dev'] }
const baselineFrom = ['humans', '!pr/authors', '!pr/opened_by']
const reasonFor = (file: string) =>
  `No rule applies to protected file '${file}': a person must approve it, and the supervisor never merges it`

describe('protected-file baseline', () => {
  it('knows policy files and classifier definitions at any depth', () => {
    const protectedFiles = [
      '.supervisor/approvals.yml',
      '.supervisor/approvals.yaml',
      '.claude/approvals.yml',
      '/.claude/approvals.yaml',
      'packages/app/.supervisor/approvals.yml',
      'packages/app/.claude/approvals.yml',
      '.claude/classifiers/flake_fix/def.yml',
      'packages/app/.claude/classifiers/flake_fix/prompt.md',
    ]
    for (const file of protectedFiles) expect(isProtectedPath(file), file).toBe(true)

    const ordinary = [
      'README.md',
      'approvals.yml',
      '.claude/settings.json',
      '.supervisor/notes.md',
      'docs/.claude/approvals.yml.md',
      '.github/workflows/ci.yml',
    ]
    for (const file of ordinary) expect(isProtectedPath(file), file).toBe(false)
  })

  it('asks one person other than the author for a protected file no rule covers', () => {
    const file = '.supervisor/approvals.yml'
    const result = evaluatePolicies([policy], { changedFiles: [file], facts: author })

    expect(result.uncoveredFiles).toEqual([file])
    expect(result.files[0]).toMatchObject({
      covered: false,
      protectedBaseline: true,
      verdict: 'comments',
      rules: [],
    })
    expect(result.verdict).toBe('comments')
    expect(result.seats).toEqual([
      { count: 1, from: baselineFrom, filledBy: [], remaining: 1, authorOnly: false },
    ])
    expect(result.authorOnlyWarnings).toEqual([])
    expect(result.nextStep).toEqual({ action: 'escalate', reason: reasonFor(file) })
  })

  it('takes no bot seat and never merges, even once a person approved', () => {
    const changedFiles = ['src/a.ts', '.claude/classifiers/flake_fix/def.yml']
    const check = (approvedBy: string[], bots: string[] = []) =>
      evaluatePolicies([policy], { changedFiles, facts: { ...author, approvedBy, bots } })

    const byBots = check(['bot:example-reviewer', 'example-ci'], ['example-ci'])
    expect(byBots.seats[0]!.filledBy).toEqual([])
    expect(byBots.seats[0]!.remaining).toBe(1)
    expect(byBots.nextStep.action).toBe('escalate')

    const byPerson = check(['example-lead'])
    expect(byPerson.seats[0]!.filledBy).toEqual(['example-lead'])
    expect(byPerson.seats[0]!.remaining).toBe(0)
    expect(byPerson.verdict).toBe('comments')
    expect(byPerson.files.map((f) => f.verdict)).toEqual(['approves', 'comments'])
    expect(byPerson.nextStep).toEqual({ action: 'escalate', reason: reasonFor(changedFiles[1]!) })
  })

  it('escalates rather than asking for a review that could not unlock the merge', () => {
    const waiting = evaluatePolicies([policy], { changedFiles: ['lib/a.ts'], facts: author })
    expect(waiting.nextStep).toEqual({ action: 'request_review', depth: 'standard' })

    const withProtected = evaluatePolicies([policy], {
      changedFiles: ['lib/a.ts', '.claude/approvals.yml'],
      facts: author,
    })
    expect(withProtected.nextStep.action).toBe('escalate')
  })

  it('applies where rules match a protected file but every if is false', () => {
    const file = 'packages/app/.claude/approvals.yml'
    const result = evaluatePolicies([policy], { changedFiles: [file], facts: author })

    expect(result.uncoveredFiles).toEqual([])
    expect(result.files[0]).toMatchObject({
      covered: true,
      noRuleApplies: true,
      protectedBaseline: true,
      verdict: 'comments',
    })
    expect(result.files[0]!.seats).toHaveLength(1)
    expect(result.seats[0]!.from).toEqual(baselineFrom)
    expect(result.nextStep).toEqual({ action: 'escalate', reason: reasonFor(file) })

    const ordinary = evaluatePolicies([policy], {
      changedFiles: ['packages/app/.claude/settings.json'],
    })
    expect(ordinary.files[0]).toMatchObject({ noRuleApplies: true, protectedBaseline: false })
    expect(ordinary.seats).toEqual([])
    expect(ordinary.nextStep).toEqual({
      action: 'escalate',
      reason: "No rule applies to 'packages/app/.claude/settings.json'",
    })
  })

  it('leaves an ordinary uncovered file and a protected file with a rule as they were', () => {
    const uncovered = evaluatePolicies([policy], { changedFiles: ['README.md'], facts: author })
    expect(uncovered.files[0]).toMatchObject({ protectedBaseline: false, verdict: null, seats: [] })
    expect(uncovered.verdict).toBeNull()
    expect(uncovered.nextStep).toEqual({
      action: 'escalate',
      reason: 'Not every changed file has a rule that approves the merge',
    })

    const covering = parsePolicySource(`
version: 1
rules:
  - purpose: This policy lets its own file merge
    paths: ['**']
    verdict: { claude: approves, seats: 0 }
`)
    const covered = evaluatePolicies([covering], { changedFiles: ['.claude/approvals.yml'] })
    expect(covered.files[0]).toMatchObject({ covered: true, protectedBaseline: false })
    expect(covered.seats).toEqual([])
    expect(covered.nextStep).toEqual({ action: 'merge' })
  })
})
