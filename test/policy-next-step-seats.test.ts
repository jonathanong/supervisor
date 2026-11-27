import { describe, expect, it } from 'vitest'
import { formatHumanCheck } from '../src/cli/policy-format.js'
import { evaluatePolicies } from '../src/policy/evaluate.js'
import { parsePolicySource } from '../src/policy/load.js'
import { checkPull } from '../src/policy/pull-check.js'

const facts = { openedBy: 'dev-one', authors: ['dev-one'] }

const policy = (seats: string, paths = "['src/**', 'lib/**']") =>
  parsePolicySource(`
version: 1
rules:
  - purpose: Seats under test
    paths: ${paths}
    verdict: { claude: approves, seats: ${seats} }
`)

describe('the next step when the verdict approves and seats are unmet', () => {
  it('requests a review at the standard depth when only a bot can fill the unmet seat', () => {
    const result = evaluatePolicies([policy("[{ count: 1, from: 'bot:example-reviewer' }]")], {
      changedFiles: ['src/a.ts'],
      facts,
    })
    expect(result.verdict).toBe('approves')
    expect(result.nextStep).toEqual({
      action: 'request_review',
      depth: 'standard',
      reason: '1 seat requirement(s) still unmet, each fillable by a bot reviewer',
    })
    expect(formatHumanCheck(result)).toContain(
      'Next step: request review at depth standard (1 seat requirement(s) still unmet, each fillable by a bot reviewer)',
    )
  })

  it('asks for a review for the bots set, ignoring a negation', () => {
    const result = evaluatePolicies([policy("[{ count: 1, from: ['bots', '!bot:other'] }]")], {
      changedFiles: ['src/a.ts'],
      facts,
    })
    expect(result.nextStep.action).toBe('request_review')
  })

  it('escalates when a person or a team must fill an unmet seat', () => {
    for (const from of ['humans', 'dev-two', 'example-org/example-team']) {
      const result = evaluatePolicies([policy(`[{ count: 1, from: '${from}' }]`)], {
        changedFiles: ['src/a.ts'],
        facts: { openedBy: 'bot:example-author', authors: ['bot:example-author'] },
      })
      expect(result.nextStep).toEqual({
        action: 'escalate',
        reason: '1 seat requirement(s) still unmet',
      })
    }
  })

  it('escalates when a bot seat and a human seat are both unmet', () => {
    const seats = "[{ count: 1, from: 'bot:example-reviewer' }, { count: 1, from: 'dev-two' }]"
    const result = evaluatePolicies([policy(seats)], { changedFiles: ['src/a.ts'], facts })
    expect(result.nextStep).toEqual({
      action: 'escalate',
      reason: '2 seat requirement(s) still unmet',
    })
  })

  it('reviews when the human seat is met and only the bot seat is open', () => {
    const seats = "[{ count: 1, from: 'bot:example-reviewer' }, { count: 1, from: 'dev-two' }]"
    const result = evaluatePolicies([policy(seats)], {
      changedFiles: ['src/a.ts'],
      facts: { ...facts, approvedBy: ['dev-two'] },
    })
    expect(result.nextStep.action).toBe('request_review')
    expect(result.nextStep).toMatchObject({ reason: expect.stringContaining('1 seat') })
  })

  it('counts a seat once however many files and rules ask for it, as the report prints it', () => {
    const second = parsePolicySource(`
version: 1
rules:
  - purpose: First
    paths: ['src/**']
    verdict: { claude: approves, seats: [{ count: 1, from: 'bot:example-reviewer' }] }
  - purpose: Second
    paths: ['src/**', 'lib/**']
    verdict: { claude: approves, seats: [{ count: 1, from: 'bot:example-reviewer' }] }
`)
    const result = evaluatePolicies([second], { changedFiles: ['src/a.ts', 'lib/b.ts'], facts })
    expect(result.seats.length).toBeGreaterThan(1)
    expect(result.nextStep).toMatchObject({
      action: 'request_review',
      depth: 'standard',
      reason: expect.stringContaining('1 seat requirement(s)'),
    })
  })

  it('uses the review depth the rule asks for', () => {
    const deep = parsePolicySource(`
version: 1
rules:
  - purpose: Deep review
    paths: ['src/**']
    verdict: { claude: comments, seats: 0 }
    override:
      - if: 'claude/code_review(level=deep) = pass'
        verdict: { claude: approves, seats: [{ count: 1, from: 'bot:example-reviewer' }] }
`)
    const result = evaluatePolicies([deep], {
      changedFiles: ['src/a.ts'],
      facts,
      classifiers: { 'claude/code_review': { status: 'complete', value: 'pass', level: 'deep' } },
    })
    expect(result.nextStep).toMatchObject({ action: 'request_review', depth: 'deep' })
  })

  it('keeps request_review over shepherd, and escalate for a blocker', () => {
    const policies = [policy("[{ count: 1, from: 'bot:example-reviewer' }]")]
    const base = {
      changedFiles: ['src/a.ts'],
      facts,
      pull: { repository: 'example-org/example-repo', number: 1, head: 'a'.repeat(40) },
      readiness: { ready: false, action: 'triage' },
      blockers: [],
    }
    expect(checkPull(policies, base).nextStep.action).toBe('request_review')
    expect(
      checkPull(policies, { ...base, blockers: ['The pull request is a draft'] }).nextStep,
    ).toEqual({
      action: 'escalate',
      reason: 'The pull request is a draft',
    })
  })
})
