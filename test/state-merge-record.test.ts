import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop, NOW, type Loop } from './helpers/loop.js'

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/policies/${name}`, import.meta.url))
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const PR = 'example-org/example-repo#12'
const rule = { purpose: 'Docs changes merge', sourceFile: '.claude/approvals.yml' }
const seat = { count: 1, from: ['humans'], filledBy: ['reviewer-login'], remaining: 0 }
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
}
const input = {
  changedFiles: ['docs/a.md'],
  facts: { repository: 'Example-Org/example-repo' },
  classifiers: { 'claude/code_review': { status: 'complete', value: 'pass' } },
}

/** Run `state merge-record` with a check result and an input written to files. */
async function record(loop: Loop, check: unknown, given: unknown = input, extra: string[] = []) {
  const dir = dirname(loop.stateDir)
  const text = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value))
  await writeFile(join(dir, 'check.json'), text(check))
  await writeFile(join(dir, 'input.json'), text(given))
  const files = ['--check', join(dir, 'check.json'), '--input', join(dir, 'input.json')]
  const who = ['--review', 'reviewer-login approved', '--always-human', 'clear, checker-login']
  return await loop.cli([
    'state',
    'merge-record',
    '--pr',
    PR,
    '--head',
    HEAD,
    ...files,
    ...who,
    ...extra,
  ])
}

describe('supervisor state merge-record', () => {
  afterEach(cleanupLoops)

  it('records a merge that the real policy check allows', async () => {
    const loop = await makeLoop()
    const given = fixture('inputs/docs-pass.json')
    const checked = await loop.cli([
      'policy',
      'check',
      '--dir',
      fixture('docs-light'),
      '--input',
      given,
      '--json',
    ])
    expect(checked.code).toBe(0)
    const check = join(dirname(loop.stateDir), 'check.json')
    await writeFile(check, checked.stdout)
    const who = ['--review', 'none', '--always-human', 'clear, checker-login']
    const flags = ['--pr', PR, '--head', HEAD.toUpperCase(), '--check', check, '--input', given]
    const done = await loop.cli(['state', 'merge-record', ...flags, ...who])
    expect(done).toMatchObject({ code: 0, stderr: '' })
    const stored = (await loop.state()).mergeRecords
    expect(stored).toEqual([
      {
        pr: PR,
        head: HEAD,
        at: NOW,
        rules: [
          {
            purpose: 'Docs changes need only a quick AI review',
            sourceFile: expect.stringContaining('approvals.yml'),
          },
        ],
        classifiers: {
          'claude/code_review': {
            status: 'complete',
            value: 'pass',
            level: 'quick',
            severity: 'none',
          },
        },
        seats: [],
        review: 'none',
        alwaysHuman: 'clear, checker-login',
      },
    ])
    expect(JSON.parse(done.stdout)).toEqual(stored[0])
  })

  it('keeps each applied rule once, and the seats with who filled them', async () => {
    const loop = await makeLoop()
    expect((await record(loop, allowed)).code).toBe(0)
    expect((await record(loop, allowed, { changedFiles: [] })).code).toBe(0)
    const [first, second] = (await loop.state()).mergeRecords
    expect(first).toMatchObject({
      rules: [rule],
      classifiers: input.classifiers,
      seats: [
        { count: 1, from: ['humans'], filledBy: ['reviewer-login'] },
        { count: null, from: [], filledBy: [] },
      ],
      review: 'reviewer-login approved',
    })
    expect(Object.keys(first)).toEqual([
      'pr',
      'head',
      'at',
      'rules',
      'classifiers',
      'seats',
      'review',
      'alwaysHuman',
    ])
    expect(second.classifiers).toEqual({})
  })

  it('refuses a check whose next step is not merge, or that is not a check result', async () => {
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
      [{ ...allowed, authorOnlyWarnings: ['seat filled by the author'] }, 'author-only warnings'],
      [{ ...allowed, authorOnlyWarnings: undefined }, 'author-only warnings'],
      [{ ...allowed, files: [{ file: 'a', rules: [] }] }, 'names no rule that allowed the merge'],
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
    const other = { ...input, facts: { repository: 'example-org/other-repo' } }
    expect((await record(loop, allowed, other)).stderr).toMatch(
      /^merge-record: --input .+ is for example-org\/other-repo, not example-org\/example-repo\n$/,
    )
    expect((await record(loop, allowed, { classifiers: [] })).stderr).toContain(
      'classifiers must be object',
    )
    expect((await record(loop, allowed, '7')).stderr).toContain('must hold a JSON object')
    const missing = ['--check', join(loop.stateDir, 'absent.json')]
    expect((await record(loop, allowed, input, missing)).stderr).toContain('ENOENT')
    for (const [flag, value] of [
      ['--pr', 'example-repo#12'],
      ['--head', 'a1b2c3d'],
    ]) {
      const refused = await record(loop, allowed, input, [flag!, value!])
      expect(refused).toMatchObject({ code: 1, stderr: expect.stringContaining(`'${value}' must`) })
    }
    await expect(loop.state()).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('exits 2 when a flag is missing or empty', async () => {
    const loop = await makeLoop()
    const all = ['--pr', PR, '--head', HEAD, '--check', 'c', '--input', 'i', '--review', 'r']
    for (let at = 0; at < all.length; at += 2) {
      const args = [...all.slice(0, at), ...all.slice(at + 2), '--always-human', 'clear']
      const result = await loop.cli(['state', 'merge-record', ...args])
      expect(result).toMatchObject({ code: 2, stdout: '' })
      expect(result.stderr).toContain(`${all[at]} is required`)
    }
    expect((await loop.cli(['state', 'merge-record', ...all])).stderr).toContain(
      '--always-human is required',
    )
    expect((await record(loop, allowed, input, ['--review', '  '])).stderr).toContain(
      '--review must not be empty',
    )
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
