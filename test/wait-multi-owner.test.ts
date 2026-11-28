import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop, NOW } from './helpers/loop.js'
import {
  decodeCursor,
  envelope,
  lines,
  makeWorld,
  mergeEvent,
  type RelayReply,
  type RelayRequest,
} from './helpers/wait.js'

const SCOPES = [
  { owner: 'example-org', kind: 'org', repos: '*', excludedRepos: ['skip-me'], mode: 'enforce' },
  { owner: 'example-user', kind: 'user', repos: ['demo-repo'], mode: 'report' },
  { owner: 'example-team', kind: 'org', repos: ['team-repo'], excludeForks: true, mode: 'report' },
  { owner: 'example-org', kind: 'org', repos: ['extra-repo'], mode: 'report' },
]

/** One `gh` listing per owner, answered by the endpoint it was asked for. */
function listingWorld(
  replies: RelayReply[] | ((req: RelayRequest) => RelayReply),
  overrides: Record<string, string> = {},
) {
  const world = makeWorld({ replies, login: 'example-user' })
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

  it('polls every distinct owner with the union of selected repositories in one wait', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    const seenOwners = new Set<string>()
    const world = listingWorld((req) => {
      seenOwners.add(req.owner!)
      return { events: [], timedOut: seenOwners.size === 3 }
    })
    expect((await loop.cli(['wait'], world.run, undefined, world.io)).code).toBe(0)
    const repos =
      'example-org/alpha,example-org/extra-repo,example-user/demo-repo,example-team/team-repo'
    expect([...seenOwners].sort()).toEqual(['example-org', 'example-team', 'example-user'])
    for (const req of world.requests) {
      expect(req.repos).toBe(repos)
      expect(req.after).toBe(String(Date.parse(NOW) - 10 * 60 * 1000))
    }
    // gh asks who is signed in once, however many user scopes there are.
    expect(world.calls.filter((call) => call.args[1] === 'user')).toHaveLength(1)
    expect((await loop.state()).hookHarness).toEqual({ seen: [] })
  })

  it('reports each event and merge under its own owner and round-trips a multi-owner cursor', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    const byOwner: Record<string, RelayReply[]> = {
      'example-org': [
        { events: [mergeEvent('m1', 'alpha', 4)], cursor: '1767323045010#org' },
        { events: [], cursor: '1767323045020#org', timedOut: true },
      ],
      'example-user': [
        { events: [], cursor: '1767323045011#user' },
        {
          events: [
            envelope({
              id: 'f1',
              owner: 'example-user',
              repo: 'demo-repo',
              event: 'workflow_run',
              action: 'completed',
              conclusion: 'failure',
              headRef: 'main',
              workflow: 'ci',
              runId: 9,
              sender: null,
            }),
          ],
          cursor: '1767323045021#user',
        },
      ],
      'example-team': [
        { events: [], cursor: '1767323045012#team' },
        { events: [], cursor: '1767323045022#team' },
      ],
    }
    const world = listingWorld((req) => byOwner[req.owner!]!.shift() ?? { events: [] })
    const out = lines(
      (await loop.cli(['wait', '--advance'], world.run, undefined, world.io)).stdout,
    )
    expect(out[0]).toMatchObject({
      gap: false,
      events: 1,
      advanced: true,
      quiet: { count: 1, merges: ['example-org/alpha#4'] },
    })
    expect(out[1]).toEqual({
      id: 'f1',
      repo: 'example-user/demo-repo',
      event: 'workflow_run',
      action: 'completed',
      conclusion: 'failure',
      workflow: 'ci',
      runId: 9,
    })
    const state = await loop.state()
    expect(state.hookHarness.seen).toEqual(['m1', 'f1'])
    const decoded = decodeCursor(state.hookHarness.cursor)
    expect(decoded.v).toBe(2)
    expect(decoded.owners['example-org'].sk).toBe('1767323045020#org')
    expect(decoded.owners['example-user'].sk).toBe('1767323045021#user')

    // A second wait resumes every owner from its own position in the stored v2 cursor.
    const nextWorld = listingWorld((req) => ({
      events: [],
      cursor: req.after!,
      timedOut: true,
    }))
    expect((await loop.cli(['wait'], nextWorld.run, undefined, nextWorld.io)).code).toBe(0)
    const resumed = Object.fromEntries(nextWorld.requests.map((req) => [req.owner, req.after]))
    expect(resumed['example-org']).toBe('1767323045020#org')
    expect(resumed['example-user']).toBe('1767323045021#user')
  })

  it('upgrades a 0.3.0 state: per-owner entries dropped, seen ids kept, first wait from 10m ago', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    await loop.seed({
      hookHarness: {
        'example-org': { cursor: 'o1', seen: ['m1', 'x'] },
        'example-user': { cursor: 'u1', seen: ['y'] },
      },
    })
    let round = 0
    const world = listingWorld((req) => {
      if (req.owner === 'example-org' && round === 0) {
        round = 1
        return {
          events: [mergeEvent('m1', 'alpha', 4), mergeEvent('m2', 'alpha', 5)],
          cursor: '1767323045010#org',
        }
      }
      return { events: [], cursor: '1767323045099#end', timedOut: round === 1 }
    })
    expect((await loop.cli(['wait'], world.run, undefined, world.io)).code).toBe(0)
    const orgPolls = world.requests.filter((req) => req.owner === 'example-org')
    expect(orgPolls[0]!.after).toBe(String(Date.parse(NOW) - 10 * 60 * 1000))
    expect(orgPolls[1]!.after).toBe('1767323045010#org')
    const state = await loop.state()
    expect(state.hookHarness.seen).toEqual(['m1', 'x', 'y', 'm2'])
    expect(decodeCursor(state.hookHarness.cursor).owners['example-org'].sk).toBe(
      '1767323045010#org',
    )
  })

  it('skips, with a warning, an owner whose scopes select no repository', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    const world = listingWorld(
      [
        { events: [], timedOut: true },
        { events: [], timedOut: true },
      ],
      {
        'orgs/example-team': 'forked\ttrue\n',
      },
    )
    const result = await loop.cli(['wait'], world.run, undefined, world.io)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      'supervisor wait: skipping example-team: no repositories match its configuration\n',
    )
    expect(world.requests.every((req) => req.owner !== 'example-team')).toBe(true)
    expect(world.requests[0]!.repos).toBe(
      'example-org/alpha,example-org/extra-repo,example-user/demo-repo',
    )
  })

  it('fails when no owner selects any repository', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    const world = makeWorld({ listing: 'skip-me\tfalse\n', login: 'example-user' })
    const result = await loop.cli(['wait'], world.run, undefined, world.io)
    expect(result.code).toBe(1)
    expect(result.stderr).toBe('supervisor wait: no repositories match the configuration\n')
    expect(result.stdout).toContain('skipping example-org')
    expect(world.requests).toEqual([])
  })
})
