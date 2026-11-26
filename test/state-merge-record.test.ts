import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop, NOW, type Loop } from './helpers/loop.js'
import { check as pullCheck, file, fixture, HEAD, policyDir } from './helpers/pull.js'

const PR = 'example-org/example-repo#7'
const rule = { purpose: 'Docs changes merge', sourceFile: '.claude/approvals.yml' }
const seat = { count: 1, from: ['humans'], filledBy: ['reviewer-login'], remaining: 0 }
const review = { status: 'complete', value: 'pass', level: 'quick' }
const allowed = {
  files: [
    { file: 'docs/a.md', rules: [rule, { ...rule, verdict: { claude: 'approves' } }] },
    { file: 'docs/b.md', rules: [rule, 'junk', { purpose: 'no source' }, { sourceFile: 'x' }] },
    'junk',
    { file: 'docs/c.md' },
  ],
  seats: [seat, 'junk', {}],
  authorOnlyWarnings: [],
  nextStep: { action: 'merge' },
  pull: { repository: 'Example-Org/example-repo', number: 7, head: HEAD.toUpperCase() },
  readiness: { ready: true, action: 'merge', summary: 'all checks passed' },
  blockers: [],
  classifiers: { 'claude/code_review': review },
}
const WHO = ['--review', 'reviewer-login approved', '--always-human', 'clear, checker-login']

/** Run `state merge-record` with a check result written to a file. */
async function record(loop: Loop, check: unknown, extra: string[] = []) {
  const path = join(dirname(loop.stateDir), 'check.json')
  await writeFile(path, typeof check === 'string' ? check : JSON.stringify(check))
  const flags = ['--pr', PR, '--head', HEAD, '--check', path]
  return await loop.cli(['state', 'merge-record', ...flags, ...WHO, ...extra])
}

describe('supervisor state merge-record', () => {
  afterEach(cleanupLoops)

  it('records a merge that the real check of the pull request allows', async () => {
    const loop = await makeLoop()
    const dir = dirname(loop.stateDir)
    await writeFile(join(dir, 'classifiers.json'), JSON.stringify({ 'claude/code_review': review }))
    const options = ['--dir', policyDir('pull-facts'), '--json']
    const checked = await pullCheck(fixture({ files: [file('docs/guide.md')], reviews: [] }), [
      ...options,
      '--classifiers',
      join(dir, 'classifiers.json'),
    ])
    expect(checked.code).toBe(0)
    const done = await record(loop, checked.stdout)
    expect(done).toMatchObject({ code: 0, stderr: '' })
    const stored = (await loop.state()).mergeRecords
    expect(stored).toEqual([
      {
        pr: PR,
        head: HEAD,
        at: NOW,
        rules: [
          {
            purpose: 'Docs merge once a quick review passes',
            sourceFile: expect.stringContaining('approvals.yml'),
          },
        ],
        classifiers: { 'claude/code_review': review },
        seats: [],
        readiness: { ready: true, action: 'merge' },
        review: 'reviewer-login approved',
        alwaysHuman: 'clear, checker-login',
      },
    ])
    expect(JSON.parse(done.stdout)).toEqual(stored[0])
  })

  it('keeps each applied rule once, the seats with who filled them, and the readiness', async () => {
    const loop = await makeLoop()
    expect((await record(loop, allowed)).code).toBe(0)
    const bare = { ...allowed, classifiers: undefined, readiness: { ready: true } }
    expect((await record(loop, bare)).code).toBe(0)
    const [first, second] = (await loop.state()).mergeRecords
    expect(first).toMatchObject({
      rules: [rule],
      classifiers: allowed.classifiers,
      seats: [
        { count: 1, from: ['humans'], filledBy: ['reviewer-login'] },
        { count: null, from: [], filledBy: [] },
      ],
      readiness: { ready: true, action: 'merge' },
    })
    expect(Object.keys(first)).toEqual(
      'pr head at rules classifiers seats readiness review alwaysHuman'.split(' '),
    )
    expect(second).toMatchObject({ classifiers: {}, readiness: { ready: true, action: null } })
  })

  it('refuses a check of another pull request or head, or one not read from GitHub', async () => {
    const loop = await makeLoop()
    const of = (pull: unknown) => ({ ...allowed, pull })
    const refusals: Array<[unknown, string]> = [
      [
        of(undefined),
        'merge-record: the check names no pull request: record a merge from ' +
          '"supervisor policy check <owner>/<repo> <N> --json", not from --input\n',
      ],
      [
        of({ ...allowed.pull, repository: 'example-org/other-repo' }),
        `merge-record: the check is of example-org/other-repo#7, not --pr ${PR}\n`,
      ],
      [
        of({ ...allowed.pull, number: 70 }),
        `merge-record: the check is of Example-Org/example-repo#70, not --pr ${PR}\n`,
      ],
      [
        of({ ...allowed.pull, head: 'b'.repeat(40) }),
        `merge-record: the check is of head ${'b'.repeat(40)}, not --head ${HEAD}\n`,
      ],
      [of({}), `merge-record: the check is of undefined#undefined, not --pr ${PR}\n`],
    ]
    for (const [check, message] of refusals) {
      expect(await record(loop, check)).toEqual({ code: 1, stdout: '', stderr: message })
    }
    await expect(loop.state()).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a check that does not allow the merge, or that is not a check result', async () => {
    const loop = await makeLoop()
    const refusals: Array<[unknown, string]> = [
      [
        { ...allowed, nextStep: { action: 'escalate', reason: 'A matching rule blocks merge' } },
        'merge-record: the check\'s next step is "escalate" (A matching rule blocks merge), not "merge"\n',
      ],
      [
        { ...allowed, nextStep: { action: 'request_review', depth: 'deep' } },
        'merge-record: the check\'s next step is "request_review", not "merge"\n',
      ],
      [{ ...allowed, nextStep: {} }, 'merge-record: the check\'s next step is null, not "merge"\n'],
      [
        { ...allowed, blockers: ['The pull request is a draft'] },
        'merge-record: the check has blockers: ["The pull request is a draft"]\n',
      ],
      [{ ...allowed, blockers: undefined }, 'merge-record: the check has blockers: null\n'],
      [{ ...allowed, readiness: { ready: false, action: 'wait' } }, '(its action is "wait")'],
      [{ ...allowed, readiness: { action: 'merge' } }, '(its action is "merge")'],
      [{ ...allowed, readiness: undefined }, 'ready to merge (its action is null)'],
      [{ ...allowed, authorOnlyWarnings: ['seat filled by the author'] }, 'author-only warnings'],
      [{ ...allowed, authorOnlyWarnings: undefined }, 'author-only warnings'],
      [{ ...allowed, files: [{ file: 'a', rules: [] }] }, 'names no rule that allowed the merge'],
      [{ ...allowed, classifiers: [] }, 'classifiers must be object'],
      [{ ...allowed, nextStep: 'merge' }, 'is not the JSON that "supervisor policy check --json"'],
      [{ ...allowed, files: {} }, 'is not the JSON that "supervisor policy check --json" prints'],
      [{ ...allowed, seats: undefined }, 'is not the JSON that "supervisor policy check --json"'],
      [[allowed], 'check.json must hold a JSON object'],
      ['{oops', '--check '],
    ]
    for (const [check, message] of refusals) {
      const refused = await record(loop, check)
      expect(refused).toMatchObject({ code: 1, stdout: '' })
      expect(refused.stderr).toContain(message)
    }
    const missing = ['--check', join(loop.stateDir, 'absent.json')]
    expect((await record(loop, allowed, missing)).stderr).toContain('ENOENT')
    for (const [flag, value] of [
      ['--pr', 'example-repo#7'],
      ['--head', 'a1b2c3d'],
    ]) {
      const refused = await record(loop, allowed, [flag!, value!])
      expect(refused).toMatchObject({ code: 1, stderr: expect.stringContaining(`'${value}' must`) })
    }
    await expect(loop.state()).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('exits 2 when a flag is missing or empty, or --input is given', async () => {
    const loop = await makeLoop()
    const all = ['--pr', PR, '--head', HEAD, '--check', 'c', '--review', 'r']
    for (let at = 0; at < all.length; at += 2) {
      const args = [...all.slice(0, at), ...all.slice(at + 2), '--always-human', 'clear']
      const result = await loop.cli(['state', 'merge-record', ...args])
      expect(result).toMatchObject({ code: 2, stdout: '' })
      expect(result.stderr).toContain(`${all[at]} is required`)
    }
    expect((await loop.cli(['state', 'merge-record', ...all])).stderr).toContain(
      '--always-human is required',
    )
    expect((await record(loop, allowed, ['--review', '  '])).stderr).toContain(
      '--review must not be empty',
    )
    expect((await record(loop, allowed, ['--input', 'i'])).code).toBe(2)
  })

  it('refuses while the stop switch is set', async () => {
    const loop = await makeLoop()
    await loop.cli(['stop', '--reason', 'pause'])
    const stopped = await record(loop, allowed)
    expect(stopped).toMatchObject({ code: 3, stdout: '' })
    expect(stopped.stderr).toMatch(/^supervisor state merge-record: stopped by .+ \(pause\); /)
    await loop.cli(['resume'])
    expect((await record(loop, allowed)).code).toBe(0)
  })
})
