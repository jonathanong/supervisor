import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop } from './helpers/loop.js'
import { lines, makeWorld, mergeEvent } from './helpers/wait.js'

const WAIT = ['wait', '--owner', 'example-org']
const resolved = Array.from({ length: 6 }, () => [true])

describe('supervisor wait: merged pull requests', () => {
  afterEach(cleanupLoops)

  it('returns a merge with unresolved threads, late reviews, or more pages than it reads', async () => {
    const loop = await makeLoop()
    const late = { body: 'Please fix', submittedAt: '2026-01-01T00:00:01Z' }
    const world = makeWorld({
      results: [
        {
          events: [
            mergeEvent('m1', 'example-repo', 4),
            mergeEvent('m2', 'example-repo', 5),
            mergeEvent('m3', 'example-repo', 6),
          ],
        },
      ],
      pulls: {
        'example-org/example-repo#4': { threads: [[false, true]], reviews: [[late]] },
        'example-org/example-repo#5': { threads: resolved },
      },
    })
    const result = await loop.cli(WAIT, world.run)
    const merge = { repo: 'example-repo', event: 'pull_request', action: 'closed', merged: true }
    expect(lines(result.stdout)).toEqual([
      { events: 2, quiet: { count: 1, merges: ['example-org/example-repo#6'] } },
      { id: 'm1', ...merge, prs: [4], unresolved: 1, late: 1 },
      { id: 'm2', ...merge, prs: [5], unresolved: 0, late: 0, truncated: true },
    ])
    expect((await loop.state()).hookHarness['example-org'].seen).toEqual(['m3'])
  })

  it('returns a merge it cannot check, with the error cut to 200 characters', async () => {
    const loop = await makeLoop()
    const name = `bad repo ${'x'.repeat(300)}`
    const unnumbered = {
      event: 'pull_request',
      action: 'closed',
      payload: { pull_request: { merged: true } },
    }
    const world = makeWorld({ results: [{ events: [mergeEvent('m1', name, 8), unnumbered] }] })
    const [summary, first, second] = lines((await loop.cli(WAIT, world.run)).stdout)
    expect(summary).toEqual({ events: 2 })
    expect(first!.lateReviewError).toHaveLength(200)
    expect(first!.lateReviewError).toMatch(/^'example-org\/bad repo x+/)
    expect(second).toEqual({
      event: 'pull_request',
      action: 'closed',
      merged: true,
      lateReviewError: "'example-org/#None' must look like owner/repo#N",
    })
    expect(world.calls.filter((call) => call.args[1] === 'graphql')).toEqual([])
  })

  it('returns a clean merge that a loop record names, and not one whose number only starts the same', async () => {
    const loop = await makeLoop()
    await loop.seed({
      escalations: { 'example-org/example-repo#61': {} },
      routed: [{ what: 'see Example-Repo#6, then example-repo#71' }],
      hookHarness: { 'example-org': { cursor: 'c0' } },
    })
    const events = [mergeEvent('m1', 'example-repo', 6), mergeEvent('m2', 'example-repo', 7)]
    const world = makeWorld({ results: [{ events }] })
    const [summary, tracked] = lines((await loop.cli(WAIT, world.run)).stdout)
    expect(summary!.quiet.merges).toEqual(['example-org/example-repo#7'])
    expect(tracked).toMatchObject({ id: 'm1', tracked: true })
  })

  it('skips a merge already seen and keeps one pending update check per repository', async () => {
    const loop = await makeLoop({ dependencyBot: { author: 'app/Renovate' }, eventWait: {} })
    const at = '2026-01-02T03:00:00Z'
    await loop.seed({
      hookHarness: { 'example-org': { seen: ['m1'], cursor: 'c0' } },
      pendingUpdateChecks: [{ repo: 'example-org/example-repo', at }, 'junk'],
      quietMerges: [7, 'example-org/example-repo#1'],
    })
    const events = [
      mergeEvent('m1', 'example-repo', 4),
      mergeEvent('m2', 'example-repo', 5, 'renovate[bot]'),
      mergeEvent('m3', 'other-repo', 6, 'Renovate'),
      { ...mergeEvent('', 'other-repo', 7, 'dependabot[bot]'), id: undefined },
    ]
    const world = makeWorld({ results: [{ events, gap: true, cursor: 'c1' }] })
    const [summary] = lines((await loop.cli(WAIT, world.run)).stdout)
    expect(summary).toEqual({
      gap: true,
      events: 0,
      quiet: {
        count: 4,
        merges: [
          'example-org/example-repo#1',
          'example-org/example-repo#5',
          'example-org/other-repo#6',
          'example-org/other-repo#7',
        ],
      },
      pendingUpdateChecks: ['example-org/example-repo', 'example-org/other-repo'],
    })
    const state = await loop.state()
    expect(state.quietMerges).toEqual([7])
    expect(state.hookHarness['example-org']).toEqual({ seen: ['m1', 'm2', 'm3'], cursor: 'c0' })
    expect(state.pendingUpdateChecks).toEqual([
      { repo: 'example-org/example-repo', at },
      'junk',
      { repo: 'example-org/other-repo', at: '2026-01-02T03:04:05Z' },
    ])
  })

  it('uses dependabot as the dependency bot when none is configured', async () => {
    const loop = await makeLoop({ dependencyBot: undefined })
    const events = [mergeEvent('m1', 'example-repo', 4, 'app/dependabot')]
    const world = makeWorld({ results: [{ events, timedOut: true }] })
    const [summary] = lines((await loop.cli(WAIT, world.run)).stdout)
    expect(summary!.pendingUpdateChecks).toEqual(['example-org/example-repo'])
  })

  it('keeps waiting after quiet merges with what remains of the timeout', async () => {
    const loop = await makeLoop()
    const merged = mergeEvent('m1', 'example-repo', 4)
    const world = makeWorld({
      results: [
        { events: [{ ...merged, payload: { pull_request: { merged: true } } }] },
        { events: [] },
      ],
    })
    const [summary] = lines((await loop.cli(WAIT, world.run)).stdout)
    expect(summary).toEqual({
      events: 0,
      quiet: { count: 1, merges: ['example-org/example-repo#4'] },
    })
    expect(world.waits().map((args) => [args[5], args.at(-1)])).toEqual([
      ['--since', '2h'],
      ['--since', '7200s'],
    ])
    expect(world.calls.filter((call) => call.args[1] === '--paginate')).toHaveLength(1)
  })

  it('reports a watch when its last pull request merges, until it is acknowledged', async () => {
    const loop = await makeLoop()
    await loop.seed({
      watches: [
        {
          id: 'w1',
          notify: 's1',
          prs: ['Example-Org/example-repo#4', 'example-org/other-repo#5'],
          merged: ['example-org/other-repo#5'],
        },
        {
          id: 'w2',
          notify: 's2',
          note: 'later',
          prs: ['example-org/example-repo#4', 'example-org/example-repo#9', 3],
        },
        { id: 'w3', prs: ['example-org/example-repo#4'], ackedAt: '2026-01-01T00:00:00Z' },
        'junk',
      ],
    })
    const world = makeWorld({ results: [{ events: [mergeEvent('m1', 'example-repo', 4)] }] })
    const [summary, trigger] = lines((await loop.cli(WAIT, world.run)).stdout)
    expect(summary!.events).toBe(1)
    expect(trigger).toEqual({
      event: 'watch',
      id: 'w1',
      notify: 's1',
      note: '',
      prs: ['Example-Org/example-repo#4', 'example-org/other-repo#5'],
    })
    const { watches } = await loop.state()
    expect(watches[0].merged).toEqual(['example-org/example-repo#4', 'example-org/other-repo#5'])
    expect(watches[1].merged).toEqual(['example-org/example-repo#4'])
    const again = lines((await loop.cli(WAIT, makeWorld().run)).stdout)
    expect(again).toEqual([{ gap: false, events: 1 }, trigger])
  })
})
