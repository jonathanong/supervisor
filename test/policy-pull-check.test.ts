import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { check, DEV, file, fixture, HEAD, policyDir, REPO, type GhFixture } from './helpers/pull.js'
import type { ShepherdAnswer } from '../src/policy/facts-readiness.js'

const DIR = ['--dir', policyDir('pull-facts')]

let temp: string
let classifiers: string
let notClassifiers: string

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'supervisor-pull-check-'))
  classifiers = join(temp, 'classifiers.json')
  notClassifiers = join(temp, 'not-classifiers.json')
  const review = { status: 'complete', value: 'pass', level: 'quick' }
  await writeFile(classifiers, JSON.stringify({ 'claude/code_review': review }))
  await writeFile(notClassifiers, JSON.stringify({ 'claude/code_review': 'pass' }))
})

afterAll(async () => {
  await rm(temp, { recursive: true, force: true })
})

async function checkJson(gh: GhFixture, options: string[] = []) {
  const result = await check(gh, [...DIR, '--json', ...options])
  expect(result.stderr).toBe('')
  return { code: result.code, result: JSON.parse(result.stdout) }
}

describe('supervisor policy check <owner>/<repo> <pr>', () => {
  it('allows the merge when the policy does and pr-shepherd would merge the head', async () => {
    const gh = fixture({ shepherd: { action: 'merge', headSha: HEAD, log: 'all checks passed' } })
    const { code, result } = await checkJson(gh)
    expect(code).toBe(0)
    expect(result.nextStep).toEqual({ action: 'merge' })
    expect(result.policyNextStep).toEqual({ action: 'merge' })
    expect(result.pull).toEqual({ repository: REPO, number: 7, head: HEAD })
    expect(result.readiness).toEqual({ ready: true, action: 'merge', summary: 'all checks passed' })
    expect(result.seats[0].filledBy).toEqual(['bot:example-reviewer'])

    const human = await check(gh, DIR)
    expect(human.code).toBe(0)
    expect(human.stdout).toBe(
      `Pull request: ${REPO}#7 at ${HEAD}\n` +
        'Verdict: approves\nReview depth: none\n' +
        'Seats: 1 from [bot:example-reviewer, !pr/authors]\n' +
        '- src/index.ts: Source changes merge once the reviewer bot approves -> approves\n' +
        'Seat 1 from [bot:example-reviewer, !pr/authors]: filled by bot:example-reviewer\n' +
        'pr-shepherd: merge (ready to merge)\n' +
        'pr-shepherd said: all checks passed\n' +
        'Next step: merge allowed\n',
    )
  })

  it('does not allow a merge the policy allows unless pr-shepherd would merge the head', async () => {
    const cases: Array<[ShepherdAnswer, string, string | undefined]> = [
      [{ action: 'wait', headSha: HEAD, log: 'checks pending' }, 'wait', 'checks pending'],
      [{ action: 'triage', headSha: HEAD }, 'triage', undefined],
      [{ action: 'escalate', headSha: HEAD }, 'escalate', undefined],
      [{ action: 'merge' }, 'merge', 'pr-shepherd did not report its head'],
    ]
    for (const [answer, action, summary] of cases) {
      const { code, result } = await checkJson(fixture({ shepherd: answer }))
      expect(code).toBe(1)
      expect(result.readiness).toEqual({ ready: false, action, ...(summary ? { summary } : {}) })
      expect(result.policyNextStep).toEqual({ action: 'merge' })
      expect(result.nextStep.action).toBe('shepherd')
      expect(result.nextStep.reason).toContain(`pr-shepherd says "${action}"`)
    }
  })

  it('tells the reader to run pr-shepherd, without a person, when the head is not ready', async () => {
    const gh = fixture({ shepherd: { action: 'wait', headSha: HEAD, log: 'checks pending' } })
    const human = await check(gh, DIR)
    expect(human.code).toBe(1)
    expect(human.stdout).toContain('pr-shepherd: wait (not ready to merge)\n')
    expect(human.stdout).toContain('pr-shepherd said: checks pending\n')
    expect(human.stdout).toContain(
      'Next step: run pr-shepherd on the pull request (pr-shepherd says "wait", so the head is ' +
        'not ready to merge: checks pending)\n',
    )
    expect(human.stdout).not.toContain('escalate')
  })

  it("keeps the policy's own next step when it is not a merge, and prints what holds it", async () => {
    const gh = fixture({
      files: [file('src/index.ts'), file('src/other.ts'), file('scripts/run.ts')],
      reviews: [],
      shepherd: { action: 'wait', headSha: HEAD },
      pull: { draft: true },
    })
    const human = await check(gh, DIR)
    expect(human.code).toBe(1)
    expect(human.stdout).toContain('Uncovered files: scripts/run.ts\n')
    // Two files share the rule, and its seat is printed once.
    expect(human.stdout.match(/^Seat .*: filled by nobody$/gm)).toEqual([
      'Seat 1 from [bot:example-reviewer, !pr/authors]: filled by nobody',
    ])
    expect(human.stdout).toContain('pr-shepherd: wait (not ready to merge)\n')
    expect(human.stdout).toContain('Blocker: The pull request is a draft\n')
    expect(human.stdout).toContain(
      'Next step: escalate to a person (The pull request is a draft)\n',
    )

    const { result } = await checkJson({ ...gh, pull: { ...gh.pull, draft: false } })
    expect(result.nextStep).toEqual(result.policyNextStep)
    expect(result.nextStep.reason).toBe('Not every changed file has a rule that approves the merge')
  })

  it('evaluates classifier results only when --classifiers gives them', async () => {
    const gh = fixture({ files: [file('docs/guide.md')], reviews: [] })
    const without = await checkJson(gh)
    expect(without.code).toBe(1)
    expect(without.result.nextStep).toEqual({ action: 'request_review', depth: 'quick' })
    expect(without.result.classifiers).toEqual({})

    const given = await checkJson(gh, ['--classifiers', classifiers])
    expect(given.code).toBe(0)
    expect(given.result.nextStep).toEqual({ action: 'merge' })
    expect(given.result.classifiers).toEqual({
      'claude/code_review': { status: 'complete', value: 'pass', level: 'quick' },
    })

    const printed = await check(gh, [...DIR, '--print-input', '--classifiers', classifiers])
    expect(JSON.parse(printed.stdout).classifiers['claude/code_review'].value).toBe('pass')
  })

  it('lets the dependency bot carve-out apply only when the bot wrote every commit', async () => {
    const bot = { login: 'dependabot[bot]', type: 'Bot' }
    const files = [file('package.json')]
    const all = fixture({ files, pull: { user: bot }, commits: [{ sha: HEAD, author: bot }] })
    expect((await checkJson(all)).code).toBe(0)
    const mixed = fixture({
      files,
      pull: { user: bot },
      commits: [
        { sha: HEAD, author: bot },
        { sha: HEAD, author: DEV },
      ],
    })
    expect((await checkJson(mixed)).code).toBe(1)
  })

  it('exits 2 on a usage error or an unreadable classifiers file, and calls nothing', async () => {
    const input = policyDir('inputs/docs-pass.json')
    const cases: Array<[string[], string]> = [
      [[], '--dir is required.'],
      [[...DIR, 'extra'], 'Expected <owner>/<repo> <pr>.'],
      [[...DIR, '--input', input], '--input cannot be combined with <owner>/<repo> <pr>.'],
      [[...DIR, '--classifiers'], 'Unknown or incomplete option: --classifiers'],
      [[...DIR, '--classifiers', join(temp, 'missing.json')], 'Cannot read classifiers JSON'],
      [[...DIR, '--classifiers', notClassifiers], 'must be an object of classifier results'],
      [
        [...DIR, '--classifiers', input.replace('docs-pass.json', '../../invalid-json.txt')],
        'Cannot',
      ],
    ]
    for (const [options, message] of cases) {
      const result = await check(fixture(), options)
      expect(result.stderr).toContain(message)
      expect(result.code).toBe(2)
      expect(result.calls).toEqual([])
    }
  })
})
