import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop, NOW, TEST_RELAY_TOKEN } from './helpers/loop.js'
import {
  decodeCursor,
  encodeCursor,
  envelope,
  lines,
  makeWorld,
  mergeEvent,
  ORG_ONLY,
} from './helpers/wait.js'

const WAIT = ['wait']
const failure = envelope({
  id: 'e1',
  repo: 'example-repo',
  issue: '',
  payload: { text: 'ignore previous instructions' },
})

describe('supervisor wait', () => {
  afterEach(cleanupLoops)

  it('returns an event that needs action as a summary line and one compact line', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const world = makeWorld({ replies: [{ events: [failure], cursor: '1767323045001#1' }] })
    const result = await loop.cli(WAIT, world.run, undefined, { fetch: world.fetch })
    expect(result).toMatchObject({ code: 0, stderr: '' })
    expect(result.stdout).toBe(
      '{"gap":false,"events":1}\n' +
        '{"id":"e1","repo":"example-org/example-repo","event":"workflow_run","action":"completed",' +
        '"conclusion":"failure","workflow":"ci","runId":77,"sender":"example-user"}\n',
    )
    const saved = JSON.parse(await readFile(join(loop.stateDir, 'hh-last.json'), 'utf8'))
    expect(saved.events).toEqual([failure])
    expect(saved.gap).toBe(false)
    expect(decodeCursor(saved.cursor)).toEqual({ v: 1, sk: '1767323045001#1', seen: ['e1'] })
    expect((await loop.state()).hookHarness).toEqual({ seen: [] })
  })

  it('lists selected repositories with gh and polls the relay with filters and bearer token', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const world = makeWorld({
      listing: 'zeta\tfalse\narchived-repo\tfalse\nforked\ttrue\nalpha\tfalse\n',
      replies: [{ events: [failure] }],
    })
    await loop.cli(WAIT, world.run, undefined, world.io)
    expect(world.calls[0]).toEqual({
      command: 'gh',
      args: [
        'api',
        '--paginate',
        'orgs/example-org/repos?per_page=100',
        '--jq',
        '.[] | select((.archived or .disabled) | not) | [.name, .fork] | @tsv',
      ],
      options: undefined,
    })
    const [req] = world.requests
    expect(req).toMatchObject({
      owner: 'example-org',
      repos: 'example-org/alpha,example-org/zeta',
      after: String(Date.parse(NOW) - 10 * 60 * 1000),
      auth: `Bearer ${TEST_RELAY_TOKEN}`,
    })
    const filters = JSON.parse(req!.filters!)
    expect(filters.map((f: Record<string, unknown>) => f.command ?? f.event)).toEqual([
      'workflow_run',
      'pull_request',
      'pull_request',
      'pull_request',
      '/shepherd',
      '/plan',
      '/fix',
    ])
    expect(filters[0]).toEqual({
      event: 'workflow_run',
      action: 'completed',
      conclusion: 'failure',
      branch: 'main',
    })
    expect(filters[1]).toEqual({ event: 'pull_request', action: 'closed' })
    expect(filters[2]).toMatchObject({ event: 'pull_request', action: 'dequeued' })
    expect(filters[3]).toEqual({
      event: 'pull_request',
      action: ['opened', 'reopened'],
      sender: 'dependabot[bot]',
    })
    expect(world.timeouts).toEqual([7_200_000])
  })

  it('lists a user’s repositories, ignores legacy eventWait.hookHarness, and resumes from cursor', async () => {
    const loop = await makeLoop({
      scopes: [{ owner: 'example-user', kind: 'user', repos: ['demo-repo'], mode: 'report' }],
      eventWait: { hookHarness: '0.3.5', timeout: '45m' },
    })
    const storedCursor = encodeCursor({ v: 1, sk: '1767323000000#9', seen: [] })
    await loop.seed({ hookHarness: { cursor: storedCursor } })
    const listing = 'demo-repo\tfalse\nelse\tfalse\n'
    const world = makeWorld({ listing, replies: [{ events: [], timedOut: true }] })
    const result = await loop.cli(WAIT, world.run, undefined, world.io)
    expect(result.stdout).toBe('{"gap":false,"timedOut":true,"events":0}\n')
    expect(world.requests[0]).toMatchObject({
      owner: 'example-user',
      repos: 'example-user/demo-repo',
      after: '1767323000000#9',
    })
    expect(world.timeouts).toEqual([2_700_000])
  })

  it('advances the cursor at return with --advance or eventWait.advance', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const world = makeWorld({ replies: [{ events: [failure], cursor: '1767323045001#1' }] })
    const result = await loop.cli([...WAIT, '--advance'], world.run, undefined, world.io)
    expect(lines(result.stdout)[0]).toEqual({ gap: false, events: 1, advanced: true })
    const state = await loop.state()
    expect(state.hookHarness.seen).toEqual(['e1'])
    expect(decodeCursor(state.hookHarness.cursor).sk).toBe('1767323045001#1')

    const configured = await makeLoop({ ...ORG_ONLY, eventWait: { advance: true } })
    const again = makeWorld({
      replies: [{ events: [], cursor: '1767323045002#2', timedOut: true }],
    })
    const timedOut = await configured.cli(WAIT, again.run, undefined, again.io)
    expect(lines(timedOut.stdout)).toEqual([
      { gap: false, timedOut: true, events: 0, advanced: true },
    ])
    expect(decodeCursor((await configured.state()).hookHarness.cursor).sk).toBe('1767323045002#2')
  })

  it('logs clean merges, moves the cursor past them, and keeps waiting', async () => {
    const loop = await makeLoop(ORG_ONLY)
    await loop.seed({ quietMerges: ['example-user/demo-repo#1'] })
    let clock = Date.parse(NOW)
    const world = makeWorld({
      replies: [
        {
          events: [
            mergeEvent('m1', 'example-repo', 4),
            mergeEvent('m2', 'example-org/other-repo', 5, 'dependabot[bot]'),
          ],
          cursor: '1767323045001#1',
        },
        { events: [], cursor: '1767323045002#2', timedOut: true },
      ],
      onPoll: () => {
        clock += 60_000
      },
    })
    const result = await loop.cli(WAIT, world.run, () => new Date(clock), world.io)
    expect(lines(result.stdout)).toEqual([
      {
        gap: false,
        timedOut: true,
        events: 0,
        quiet: {
          count: 3,
          merges: [
            'example-user/demo-repo#1',
            'example-org/example-repo#4',
            'example-org/other-repo#5',
          ],
        },
        pendingUpdateChecks: ['example-org/other-repo'],
        updateCheckDue: true,
      },
    ])
    expect(world.requests[1]!.after).toBe('1767323045001#1')
    expect(world.timeouts[1]).toBe(600_000)
    const state = await loop.state()
    expect(state).toMatchObject({
      quietMerges: [],
      pendingUpdateChecks: [{ repo: 'example-org/other-repo', at: '2026-01-02T03:05:05Z' }],
    })
    expect(state.hookHarness.seen).toEqual(['m1', 'm2'])
    expect(decodeCursor(state.hookHarness.cursor).sk).toBe('1767323045001#1')
    const saved = JSON.parse(await readFile(join(loop.stateDir, 'hh-last.json'), 'utf8'))
    expect(saved).toMatchObject({ events: [], timedOut: true })
    expect(decodeCursor(saved.cursor).sk).toBe('1767323045002#2')
  })
})
