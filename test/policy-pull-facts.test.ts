import { describe, expect, it } from 'vitest'
import {
  check,
  commit,
  DEV,
  file,
  fixture,
  HEAD,
  NOBODY,
  OLD_HEAD,
  policyDir,
  REPO,
  review,
  REVIEWER,
  type GhFixture,
} from './helpers/pull.js'

const PRINT = ['--dir', policyDir('pull-facts'), '--print-input']

async function collect(gh: GhFixture) {
  const result = await check(gh, PRINT)
  expect(result.stderr).toBe('')
  expect(result.code).toBe(0)
  return { ...result, input: JSON.parse(result.stdout) }
}

describe('supervisor policy check <owner>/<repo> <pr> --print-input', () => {
  it('prints the input it built from GitHub, in the shape --input reads', async () => {
    const { input, calls } = await collect(fixture())
    expect(input).toEqual({
      changedFiles: ['src/index.ts'],
      facts: {
        filesChanged: 1,
        filesAdded: 0,
        filesRemoved: 0,
        diffLines: 12,
        openedBy: 'dev-one',
        authors: ['dev-one'],
        approvedBy: ['bot:example-reviewer'],
        base: 'main',
        repository: REPO,
        labels: ['automation'],
      },
      pull: { repository: REPO, number: 7, head: HEAD },
      readiness: { ready: true, action: 'merge' },
      blockers: [],
    })
    // Every call is a GET through an argument array, and its filter names no title or body.
    const pull = `repos/${REPO}/pulls/7`
    expect(calls.map((args) => args.slice(0, -2))).toEqual([
      ['api', pull],
      ['api', '--paginate', `${pull}/files?per_page=100`],
      ['api', '--paginate', `${pull}/commits?per_page=100`],
      ['api', '--paginate', `${pull}/reviews?per_page=100`],
      ['api', pull],
    ])
    for (const args of calls) {
      expect(args.at(-2)).toBe('--jq')
      expect(args.at(-1)).not.toMatch(/title|body|message|patch/)
    }
  })

  it('counts added and removed files and lists a rename under both names', async () => {
    const { input } = await collect(
      fixture({
        files: [
          file('src/new.ts', 'added'),
          file('src/gone.ts', 'removed'),
          file('src/after.ts', 'renamed', 'lib/before.ts'),
        ],
      }),
    )
    expect(input.changedFiles).toEqual([
      'src/new.ts',
      'src/gone.ts',
      'src/after.ts',
      'lib/before.ts',
    ])
    expect(input.facts).toMatchObject({ filesChanged: 3, filesAdded: 1, filesRemoved: 1 })
  })

  it('writes a GitHub App as bot:<slug> and leaves a person with a bot-like login alone', async () => {
    const dependabot = { login: 'dependabot[bot]', type: 'Bot' }
    const { input } = await collect(
      fixture({
        pull: { user: dependabot },
        commits: [
          commit(dependabot),
          commit({ login: 'dependabot', type: 'User' }),
          commit({ login: 'example-app[bot]', type: 'User' }),
          commit(DEV),
        ],
      }),
    )
    expect(input.facts.openedBy).toBe('bot:dependabot')
    expect(input.facts.authors).toEqual([
      'bot:dependabot',
      'dependabot',
      'bot:example-app',
      'dev-one',
    ])
  })

  it("counts only a reviewer's latest decision, and only on the current head", async () => {
    const person = (login: string) => ({ login, type: 'User' })
    const { input } = await collect(
      fixture({
        reviews: [
          review(person('stale'), 'APPROVED', OLD_HEAD),
          review(person('changed-mind'), 'APPROVED'),
          review(person('changed-mind'), 'CHANGES_REQUESTED'),
          review(person('dismissed'), 'APPROVED'),
          review(person('dismissed'), 'DISMISSED'),
          review(person('came-round'), 'CHANGES_REQUESTED', OLD_HEAD),
          review(person('came-round'), 'APPROVED'),
          review(person('commented-after'), 'APPROVED'),
          review(person('commented-after'), 'COMMENTED'),
          review(person('reapproved-old'), 'APPROVED'),
          review(person('reapproved-old'), 'APPROVED', OLD_HEAD),
          review(person('only-commented'), 'COMMENTED'),
          review(NOBODY, 'APPROVED'),
          review(REVIEWER, 'APPROVED'),
        ],
      }),
    )
    expect(input.facts.approvedBy).toEqual([
      'came-round',
      'commented-after',
      'bot:example-reviewer',
    ])
  })

  it('leaves authors out and adds a blocker when a commit author has no login', async () => {
    const gh = fixture({ commits: [commit(DEV), commit(NOBODY, OLD_HEAD), commit(null, HEAD)] })
    const { input } = await collect(gh)
    expect(input.facts).not.toHaveProperty('authors')
    expect(input.blockers).toEqual([
      `Commit ${OLD_HEAD.slice(0, 12)} has an author with no GitHub login`,
      `Commit ${HEAD.slice(0, 12)} has an author with no GitHub login`,
    ])

    // The policy alone would merge: the reviewer approved and no author is known to exclude.
    const checked = await check(gh)
    const result = JSON.parse(checked.stdout)
    expect(checked.code).toBe(1)
    expect(result.policyNextStep).toEqual({ action: 'merge' })
    expect(result.nextStep.action).toBe('escalate')
    expect(result.nextStep.reason).toContain('has an author with no GitHub login; Commit')
  })

  it('adds a blocker for a pull request that is closed or a draft', async () => {
    const { input } = await collect(fixture({ pull: { state: 'closed', draft: true } }))
    expect(input.blockers).toEqual(['The pull request is not open', 'The pull request is a draft'])
  })

  it('fails closed, exit 2 and no output, when the facts cannot be read whole', async () => {
    const cases: Array<[Partial<GhFixture>, string]> = [
      [{ pull: { files: 3000 } }, 'changes 3000 files and the API lists at most 3000'],
      [{ pull: { files: 2 } }, 'GitHub listed 1 of 2 changed files'],
      [{ pull: { commits: 300 } }, 'GitHub listed 1 of 300 commits'],
      [{ headAfter: OLD_HEAD }, 'got a new head while its facts were read'],
      [{ raw: { '/reviews?': 1 } }, '/reviews?per_page=100 exited 1: gh: Not Found (HTTP 404)'],
      [{ raw: { '/files?': '{"filename":' } }, 'printed something that is not JSON'],
      [{ raw: { '/files?': '"src/index.ts"\n' } }, 'printed something that is not an object'],
      [{ raw: { 'pulls/7': '\n' } }, 'pulls/7 printed nothing'],
      [{ pull: { head: 'main' } }, 'a head SHA that is not a commit SHA'],
      [{ pull: { head: null } }, 'GitHub returned no head SHA'],
      [{ pull: { user: NOBODY } }, 'GitHub returned no pull request author'],
      [{ pull: { user: { login: '', type: 'User' } } }, 'GitHub returned no pull request author'],
      [{ pull: { labels: null } }, 'GitHub returned no label list'],
      [{ pull: { labels: [{ name: 'x' }] } }, 'GitHub returned no label list'],
      [{ pull: { files: '1' } }, 'GitHub returned no file count'],
      [{ pull: { commits: -1 } }, 'GitHub returned no commit count'],
      [{ pull: { additions: 1.5 } }, 'GitHub returned no addition count'],
      [{ pull: { base: '' } }, 'GitHub returned no base branch'],
      [{ files: [{ filename: null, previous: null }] }, 'GitHub returned no file name'],
      [{ files: [{ filename: 'a', previous: 4 }] }, 'GitHub returned no previous file name'],
      [{ commits: [commit(NOBODY, null as never)] }, 'GitHub returned no commit SHA'],
    ]
    for (const [overrides, message] of cases) {
      for (const options of [PRINT, undefined]) {
        const result = await check(fixture(overrides), options)
        expect(result.stderr).toContain(message)
        expect(result.stdout).toBe('')
        expect(result.code).toBe(2)
      }
    }
  })
})
