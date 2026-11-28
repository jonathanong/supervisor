import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop } from './helpers/loop.js'
import { lines, makeWorld, mergeEvent } from './helpers/wait.js'

const SCOPES = [
  { owner: 'example-org', kind: 'org', repos: '*', excludedRepos: ['skip-me'], mode: 'enforce' },
  { owner: 'example-user', kind: 'user', repos: ['demo-repo'], mode: 'report' },
  { owner: 'example-team', kind: 'org', repos: ['team-repo'], excludeForks: true, mode: 'report' },
  { owner: 'example-org', kind: 'org', repos: ['extra-repo'], mode: 'report' },
]

/** One `gh` listing per owner, answered by the endpoint it was asked for. */
function listingWorld(
  results: Array<Record<string, unknown> | number | string>,
  overrides: Record<string, string> = {},
) {
  const world = makeWorld({ results, login: 'example-user' })
  const run = world.run
  world.run = async (command, args, options) => {
    if (command === 'gh' && args[1] === '--paginate') {
      world.calls.push({ command, args, options })
      const lists: Record<string, string> = {
        'orgs/example-org': 'alpha\tfalse\nextra-repo\tfalse\nskip-me\tfalse\n',
        'user/repos?affiliation=owner&per_page=100': 'demo-repo\tfalse\nother\tfalse\n',
        'orgs/example-team': 'team-repo\tfalse\nforked\ttrue\n',
        ...overrides,
      }
      const key = Object.keys(lists).find((name) => args[2]!.startsWith(name))!
      return { code: 0, stdout: lists[key]!, stderr: '' }
    }
    return await run(command, args, options)
  }
  return world
}

describe('supervisor wait over every owner', () => {
  afterEach(cleanupLoops)

  it('runs one hook-harness wait with the owner list and the union of selected repositories', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    const world = listingWorld([{ events: [], cursor: 'c1', timedOut: true }])
    expect((await loop.cli(['wait'], world.run)).code).toBe(0)
    const repos =
      'example-org/alpha,example-org/extra-repo,example-user/demo-repo,example-team/team-repo'
    expect(world.waits()).toEqual([
      [
        '-y',
        'hook-harness@0.4.1',
        'wait',
        '--owner',
        'example-org,example-user,example-team',
        '--since',
        '10m',
        '--repo',
        repos,
        '--on',
        'ejection,dependabot-pr,/shepherd,/plan,/fix',
        '--event',
        'workflow_run',
        '--action',
        'completed',
        '--conclusion',
        'failure',
        '--branch',
        'main',
        '--filter',
        '{"event": "pull_request", "action": "closed"}',
        '--timeout',
        '2h',
      ],
    ])
    expect(world.calls.filter((call) => call.command === 'npx')).toHaveLength(1)
    expect(world.calls.find((call) => call.command === 'npx')!.options).toEqual({
      cwd: tmpdir(),
      inheritStderr: true,
    })
    // gh asks who is signed in once, however many user scopes there are.
    expect(world.calls.filter((call) => call.args[1] === 'user')).toHaveLength(1)
    expect((await loop.state()).hookHarness).toEqual({ seen: [] })
  })

  it('reports each event and merge under its own owner, from one cursor', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    const events = [
      mergeEvent('m1', 'alpha', 4),
      mergeEvent('m2', 'example-user/demo-repo', 5),
      { id: 'f1', owner: 'example-team', repo: 'team-repo', event: 'workflow_run' },
    ]
    const world = listingWorld([{ events, cursor: 'c9', timedOut: true }])
    const out = lines((await loop.cli(['wait', '--advance'], world.run)).stdout)
    expect(out[0]).toMatchObject({
      events: 1,
      quiet: { count: 2, merges: ['example-org/alpha#4', 'example-user/demo-repo#5'] },
    })
    expect(out[1]).toEqual({
      id: 'f1',
      repo: 'example-team/team-repo',
      event: 'workflow_run',
    })
    expect((await loop.state()).hookHarness).toEqual({ seen: ['m1', 'm2', 'f1'], cursor: 'c9' })
  })

  it('starts the second round from the one stored cursor', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    const world = listingWorld([
      { events: [mergeEvent('m1', 'alpha', 4)], cursor: 'c1' },
      { events: [], cursor: 'c2', timedOut: true },
    ])
    await loop.cli(['wait'], world.run)
    expect(world.waits()[1]!.slice(5, 7)).toEqual(['--after', 'c1'])
  })

  it('upgrades a 0.3.0 state: per-owner entries dropped, seen ids kept, first wait from --since', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    await loop.seed({
      hookHarness: {
        'example-org': { cursor: 'o1', seen: ['m1', 'x'] },
        'example-user': { cursor: 'u1', seen: ['y'] },
      },
    })
    const world = listingWorld([
      { events: [mergeEvent('m1', 'alpha', 4), mergeEvent('m2', 'alpha', 5)], cursor: 'c1' },
      { events: [], cursor: 'c2', timedOut: true },
    ])
    expect((await loop.cli(['wait'], world.run)).code).toBe(0)
    expect(world.waits()[0]!.slice(5, 7)).toEqual(['--since', '10m'])
    expect(world.waits()[1]!.slice(5, 7)).toEqual(['--after', 'c1'])
    expect((await loop.state()).hookHarness).toEqual({
      seen: ['m1', 'x', 'y', 'm2'],
      cursor: 'c1',
    })
  })

  it('refuses an exact hook-harness older than 0.4.0 for several owners, and not for one or a range', async () => {
    const old = await makeLoop({ scopes: SCOPES, eventWait: { hookHarness: '0.3.5' } })
    const refused = await old.cli(['wait'], makeWorld().run)
    expect(refused).toEqual({
      code: 1,
      stdout: '',
      stderr:
        'supervisor wait: eventWait.hookHarness 0.3.5 waits for one owner and the config has ' +
        'several; use hook-harness 0.4.0 or newer\n',
    })

    const single = await makeLoop({
      scopes: SCOPES.slice(0, 1),
      eventWait: { hookHarness: '0.3.5' },
    })
    const one = makeWorld({ results: [{ events: [], timedOut: true }] })
    expect((await single.cli(['wait'], one.run)).code).toBe(0)
    expect(one.waits()[0]![1]).toBe('hook-harness@0.3.5')

    for (const hookHarness of ['^0.3.0', 'latest', '0.4.0', '1.0.0', '0.10.2']) {
      const loop = await makeLoop({ scopes: SCOPES, eventWait: { hookHarness } })
      const world = listingWorld([{ events: [], timedOut: true }])
      expect((await loop.cli(['wait'], world.run)).code).toBe(0)
      expect(world.waits()[0]![1]).toBe(`hook-harness@${hookHarness}`)
    }
  })

  it('skips, with a warning, an owner whose scopes select no repository', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    const world = listingWorld([{ events: [], timedOut: true }], {
      'orgs/example-team': 'forked\ttrue\n',
    })
    const result = await loop.cli(['wait'], world.run)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      'supervisor wait: skipping example-team: no repositories match its configuration\n',
    )
    const args = world.waits()[0]!
    expect(args[args.indexOf('--owner') + 1]).toBe('example-org,example-user')
    expect(args[args.indexOf('--repo') + 1]).toBe(
      'example-org/alpha,example-org/extra-repo,example-user/demo-repo',
    )
  })

  it('fails when no owner selects any repository', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    const world = makeWorld({ listing: 'skip-me\tfalse\n', login: 'example-user' })
    const result = await loop.cli(['wait'], world.run)
    expect(result.code).toBe(1)
    expect(result.stderr).toBe('supervisor wait: no repositories match the configuration\n')
    expect(result.stdout).toContain('skipping example-org')
    expect(world.waits()).toEqual([])
  })
})
