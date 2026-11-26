import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { REPO_LIST_JQ } from '../src/config/repos.js'
import { cleanupLoops, makeLoop } from './helpers/loop.js'
import { lines, makeWorld, mergeEvent } from './helpers/wait.js'

const DOTTED = 'example-org/example.js'
const TIME = '"2026-01-01T00:00:00Z"'

describe('a repository name with a dot in a state path', () => {
  afterEach(cleanupLoops)

  it('addresses the key when every key is its own argument', async () => {
    const loop = await makeLoop()
    const set = await loop.cli([
      'state',
      'set',
      'lateReview',
      DOTTED,
      'scannedThrough',
      '--json',
      TIME,
    ])
    expect(set).toEqual({
      code: 0,
      stdout: `{"lateReview.${DOTTED}.scannedThrough": "2026-01-01T00:00:00Z"}\n`,
      stderr: '',
    })
    await loop.cli([
      'state',
      'set',
      'lateReview',
      'example-org/.github',
      'fullScanAt',
      '--json',
      TIME,
    ])
    await loop.cli(['state', 'append', 'handledFailures', `${DOTTED}:ci.yml`, '--json', '7'])
    expect(await loop.state()).toEqual({
      lateReview: {
        [DOTTED]: { scannedThrough: '2026-01-01T00:00:00Z' },
        'example-org/.github': { fullScanAt: '2026-01-01T00:00:00Z' },
      },
      handledFailures: { [`${DOTTED}:ci.yml`]: [7] },
    })
    expect((await loop.cli(['state', 'remove', 'lateReview', DOTTED])).stdout).toBe(
      `{"lateReview.${DOTTED}": "removed"}\n`,
    )
    expect((await loop.state()).lateReview).toEqual({
      'example-org/.github': { fullScanAt: '2026-01-01T00:00:00Z' },
    })
  })

  it('refuses a dotted path that continues after a repository key, and writes nothing', async () => {
    const loop = await makeLoop()
    for (const path of [`lateReview.${DOTTED}.scannedThrough`, `reviewedComments.${DOTTED}`]) {
      const refused = await loop.cli(['state', 'set', path, '--json', TIME])
      expect(refused).toMatchObject({ code: 1, stdout: '' })
      expect(refused.stderr).toBe(
        `supervisor state: '${path}' is ambiguous: a repository name can contain a dot. ` +
          'Pass each key as its own argument, with spaces in place of the dots between keys\n',
      )
    }
    expect(
      (await loop.cli(['state', 'remove', 'lateReview.example-org/example-repo.x'])).code,
    ).toBe(1)
    await expect(loop.state()).rejects.toMatchObject({ code: 'ENOENT' })
    const plain = await loop.cli([
      'state',
      'set',
      'reviewedComments.example-org/example-repo',
      '--json',
      '[]',
    ])
    expect(plain.stdout).toBe('{"reviewedComments.example-org/example-repo": []}\n')
    expect((await loop.cli(['state', 'set', 'lateReview', '', '--json', '1'])).code).toBe(1)
    expect((await loop.cli(['state', 'set', 'nope', 'a.b', '--json', '1'])).stderr).toContain(
      "'nope a.b' must start with one of ",
    )
  })

  it('reads and writes the same key from reviewed, the path commands, and the wait', async () => {
    const loop = await makeLoop()
    const ids = join(dirname(loop.stateDir), 'ids.json')
    await writeFile(ids, JSON.stringify({ [DOTTED]: [11] }))
    expect((await loop.cli(['state', 'reviewed', '--file', ids])).stdout).toBe(`{"${DOTTED}": 1}\n`)
    await loop.cli(['state', 'append', 'reviewedComments', DOTTED, '--json', '{"id":12}'])
    expect((await loop.state()).reviewedComments[DOTTED].map((entry: any) => entry.id)).toEqual([
      11, 12,
    ])

    const world = makeWorld({
      listing: 'example.js\tfalse\n',
      results: [{ events: [mergeEvent('m1', 'example.js', 3, 'dependabot[bot]')] }, { events: [] }],
      pulls: { [`${DOTTED}#4`]: { threads: [[false]] } },
    })
    const [summary] = lines((await loop.cli(['wait', '--owner', 'example-org'], world.run)).stdout)
    expect(summary).toMatchObject({
      quiet: { merges: [`${DOTTED}#3`] },
      pendingUpdateChecks: [DOTTED],
    })
    expect(world.waits()[0]).toContain(DOTTED)
    const late = await loop.cli(['state', 'late-review', `${DOTTED}#4`], world.run)
    expect(late.stdout).toMatch(/^example-org\/example\.js#4 MERGED .+ unresolved=1 late=0\n$/)
  })
})

describe('listing the repositories of a user scope', () => {
  afterEach(cleanupLoops)
  const USER = ['wait', '--owner', 'example-user']
  const listed = { listing: 'demo-repo\tfalse\n', results: [{ events: [] }] }

  it('lists through user/repos when the scope owner is the signed-in user', async () => {
    const loop = await makeLoop()
    const world = makeWorld({ ...listed, login: 'Example-User' })
    expect((await loop.cli(USER, world.run)).code).toBe(0)
    expect(world.calls.slice(0, 2).map((call) => call.args)).toEqual([
      ['api', 'user', '--jq', '.login'],
      ['api', '--paginate', 'user/repos?affiliation=owner&per_page=100', '--jq', REPO_LIST_JQ],
    ])
    expect(REPO_LIST_JQ).toBe(
      '.[] | select((.archived or .disabled) | not) | [.name, .fork] | @tsv',
    )
    expect(world.waits()[0]).toContain('example-user/demo-repo')
  })

  it('keeps the public endpoint for another user, and asks nothing for an organization', async () => {
    const loop = await makeLoop()
    const other = makeWorld({ ...listed, login: 'someone-else' })
    await loop.cli(USER, other.run)
    expect(other.calls[1]!.args[2]).toBe('users/example-user/repos?per_page=100')
    const org = makeWorld({ results: [{ events: [] }] })
    await loop.cli(['wait', '--owner', 'example-org'], org.run)
    expect(org.calls[0]!.args[2]).toBe('orgs/example-org/repos?per_page=100')
  })

  it('fails the wait when the signed-in user cannot be read', async () => {
    const loop = await makeLoop()
    const world = makeWorld({ ...listed, login: 4 })
    expect(await loop.cli(USER, world.run)).toEqual({
      code: 1,
      stdout: '',
      stderr: 'supervisor wait: gh api user exited 4: gh: not signed in\n',
    })
    expect(world.calls).toHaveLength(1)
  })
})

describe('a tracked pull request is matched with its owner', () => {
  afterEach(cleanupLoops)

  async function trackedIds(state: Record<string, unknown>, numbers: number[]): Promise<string[]> {
    const loop = await makeLoop()
    await loop.seed(state)
    const events = numbers.map((number) => mergeEvent(`m${number}`, 'example-repo', number))
    const world = makeWorld({ results: [{ events }] })
    const [, ...returned] = lines(
      (await loop.cli(['wait', '--owner', 'example-org'], world.run)).stdout,
    )
    return returned.filter((line) => line.tracked === true).map((line) => line.id)
  }

  it('ignores a record of the same-named repository under another owner', async () => {
    const state = {
      escalations: { 'example-user/example-repo#61': {}, 'Example-Org/Example-Repo#62': {} },
      routed: [{ what: 'see other-example-org/example-repo#63' }],
      intake: ['report on example-org/example-repo#640', 'and (example-org/example-repo#65)'],
    }
    expect(await trackedIds(state, [61, 62, 63, 64, 65])).toEqual(['m62', 'm65'])
  })

  it('still matches an old record that names the repository without an owner', async () => {
    const state = {
      routed: [{ what: 'example-repo#71 sent to a worker' }, { what: 'not-example-repo#72' }],
      escalations: { 'example-repo#73': 't', 'example-repo#740': 't' },
      delegations: [7, null, { pr: 'x/example-repo#75' }],
    }
    expect(await trackedIds(state, [71, 72, 73, 74, 75])).toEqual(['m71', 'm73'])
  })
})
