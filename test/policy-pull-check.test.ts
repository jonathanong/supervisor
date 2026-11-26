import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { check, DEV, file, fixture, HEAD, policyDir, REPO, type GhFixture } from './helpers/pull.js'

const DIR = ['--dir', policyDir('pull-facts')]
const run = (name: string, status: string, conclusion: string | null = null) => ({
  name,
  status,
  conclusion,
})
const passed = (name: string) => run(name, 'completed', 'success')

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
  it('allows the merge when the policy does and every check on the head passed', async () => {
    const gh = fixture({
      runs: [
        passed('test'),
        run('docs', 'completed', 'skipped'),
        run('lint', 'completed', 'neutral'),
      ],
      statuses: [{ name: 'coverage', state: 'success' }],
    })
    const { code, result } = await checkJson(gh)
    expect(code).toBe(0)
    expect(result.nextStep).toEqual({ action: 'merge' })
    expect(result.policyNextStep).toEqual({ action: 'merge' })
    expect(result.pull).toEqual({ repository: REPO, number: 7, head: HEAD })
    expect(result.checks).toMatchObject({ state: 'success', total: 4 })
    expect(result.seats[0].filledBy).toEqual(['bot:example-reviewer'])

    const human = await check(gh, DIR)
    expect(human.code).toBe(0)
    expect(human.stdout).toBe(
      `Pull request: ${REPO}#7 at ${HEAD}\n` +
        'Verdict: approves\nReview depth: none\n' +
        'Seats: 1 from [bot:example-reviewer, !pr/authors]\n' +
        '- src/index.ts: Source changes merge once the reviewer bot approves -> approves\n' +
        'Seat 1 from [bot:example-reviewer, !pr/authors]: filled by bot:example-reviewer\n' +
        'Checks: success (4 on the head, required or not)\n' +
        'Next step: merge allowed\n',
    )
  })

  it('does not allow a merge the policy allows unless the checks passed', async () => {
    const cases: Array<[Partial<GhFixture>, string, string]> = [
      [
        { runs: [passed('test'), run('lint', 'completed', 'failure'), run('e2e', 'in_progress')] },
        'failure',
        'Checks failed on the head: lint',
      ],
      [
        { statuses: [{ name: 'deploy', state: 'error' }] },
        'failure',
        'Checks failed on the head: deploy',
      ],
      [
        { runs: [run('e2e', 'queued')], statuses: [{ name: 'coverage', state: 'pending' }] },
        'pending',
        'Checks have not finished on the head: e2e, coverage',
      ],
      [{ runs: [] }, 'none', 'The head has no checks'],
    ]
    for (const [overrides, state, reason] of cases) {
      const { code, result } = await checkJson(fixture(overrides))
      expect(code).toBe(1)
      expect(result.checks.state).toBe(state)
      expect(result.policyNextStep).toEqual({ action: 'merge' })
      expect(result.nextStep).toEqual({ action: 'escalate', reason })
    }
  })

  it("keeps the policy's own next step when it is not a merge, and prints what holds it", async () => {
    const gh = fixture({
      files: [file('src/index.ts'), file('src/other.ts'), file('scripts/run.ts')],
      reviews: [],
      runs: [run('lint', 'completed', 'failure'), run('e2e', 'queued')],
      pull: { draft: true },
    })
    const human = await check(gh, DIR)
    expect(human.code).toBe(1)
    expect(human.stdout).toContain('Uncovered files: scripts/run.ts\n')
    // Two files share the rule, and its seat is printed once.
    expect(human.stdout.match(/^Seat .*: filled by nobody$/gm)).toEqual([
      'Seat 1 from [bot:example-reviewer, !pr/authors]: filled by nobody',
    ])
    expect(human.stdout).toContain('Checks: failure (2 on the head, required or not)\n')
    expect(human.stdout).toContain('Failing checks: lint\nPending checks: e2e\n')
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

    const given = await checkJson(gh, ['--classifiers', classifiers])
    expect(given.code).toBe(0)
    expect(given.result.nextStep).toEqual({ action: 'merge' })

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
