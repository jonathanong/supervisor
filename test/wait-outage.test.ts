import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop } from './helpers/loop.js'
import { envelope, lines, makeWorld, mergeEvent } from './helpers/wait.js'

const SCOPES = [
  { owner: 'example-org', kind: 'org', repos: '*', mode: 'enforce' },
  { owner: 'example-team', kind: 'org', repos: '*', mode: 'report' },
]

function actionable(id: string) {
  return envelope({ id, owner: 'example-org', repo: 'example-org/example-repo', sender: null })
}

async function seedLast(stateDir: string, relayErrors: Record<string, unknown>) {
  await mkdir(stateDir, { recursive: true })
  await writeFile(join(stateDir, 'hh-last.json'), JSON.stringify({ events: [], relayErrors }))
}

describe('supervisor wait relay outage across rounds and relaunches', () => {
  afterEach(cleanupLoops)

  it('counts one owner relay errors across wait rounds while another owner keeps returning events', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    let merges = 0
    const world = makeWorld({
      replies: (req) => {
        if (req.owner === 'example-team') return { status: 503 }
        merges += 1
        return { events: [mergeEvent(`m${merges}`, 'example-repo', merges)] }
      },
    })
    const result = await loop.cli(['wait'], world.run, undefined, world.io)
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(
      /^supervisor wait: hook-harness relay unreachable \(5 consecutive errors for example-team\)/,
    )
    // Each round returns on the other owner's clean merge, so the outage spans several rounds.
    expect(world.timeouts.length).toBeGreaterThan(1)
  })

  it('reports one owner outage across relaunched waits when another owner returns actionable events', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    let seq = 0
    const world = makeWorld({
      replies: (req) => {
        if (req.owner === 'example-team') return { status: 503 }
        seq += 1
        return { events: [actionable(`f${seq}`)] }
      },
    })

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = await loop.cli(['wait'], world.run, undefined, world.io)
      expect(result.code).toBe(0)
      expect(lines(result.stdout)[0]).toEqual({
        gap: false,
        events: 1,
        relayErrors: { 'example-team': attempt },
      })
      const saved = JSON.parse(await readFile(join(loop.stateDir, 'hh-last.json'), 'utf8'))
      expect(saved.relayErrors).toEqual({ 'example-team': attempt })
      expect((await loop.cli(['state', 'advance-hh'])).code).toBe(0)
      expect(Object.keys((await loop.state()).hookHarness).sort()).toEqual(['cursor', 'seen'])
    }

    const fifth = await loop.cli(['wait'], world.run, undefined, world.io)
    expect(fifth.code).toBe(1)
    expect(fifth.stderr).toMatch(
      /^supervisor wait: hook-harness relay unreachable \(5 consecutive errors for example-team\)/,
    )

    // Still down on a later relaunch: fails immediately on the carried count.
    const stillDown = await loop.cli(['wait'], world.run, undefined, world.io)
    expect(stillDown.code).toBe(1)
    expect(stillDown.stderr).toMatch(
      /^supervisor wait: hook-harness relay unreachable \(5 consecutive errors for example-team\)/,
    )

    // Once the failing owner succeeds again, relayErrors clears from summary and hh-last.json.
    const quietAfterRecovery = makeWorld({
      replies: (req) =>
        req.owner === 'example-team' ? { events: [] } : { events: [], timedOut: true },
    })
    const recovered = await loop.cli(
      ['wait'],
      quietAfterRecovery.run,
      undefined,
      quietAfterRecovery.io,
    )
    expect(recovered.code).toBe(0)
    expect(lines(recovered.stdout)[0]).toEqual({ gap: false, timedOut: true, events: 0 })
    const saved = JSON.parse(await readFile(join(loop.stateDir, 'hh-last.json'), 'utf8'))
    expect(saved.relayErrors).toBeUndefined()
  })

  it('carries relayErrors across relaunches with --advance and mixed-case scope owners', async () => {
    const loop = await makeLoop({
      scopes: [
        { owner: 'Example-Org', kind: 'org', repos: '*', mode: 'enforce' },
        { owner: 'Example-Team', kind: 'org', repos: '*', mode: 'report' },
      ],
    })
    let seq = 0
    const world = makeWorld({
      replies: (req) => {
        if (req.owner === 'example-team') return { status: 503 }
        seq += 1
        return { events: [actionable(`a${seq}`)] }
      },
    })

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = await loop.cli(['wait', '--advance'], world.run, undefined, world.io)
      expect(result.code).toBe(0)
      expect(lines(result.stdout)[0]).toEqual({
        gap: false,
        events: 1,
        relayErrors: { 'example-team': attempt },
        advanced: true,
      })
    }

    const fifth = await loop.cli(['wait', '--advance'], world.run, undefined, world.io)
    expect(fifth.code).toBe(1)
    expect(fifth.stderr).toMatch(
      /^supervisor wait: hook-harness relay unreachable \(5 consecutive errors for example-team\)/,
    )
  })

  it('preserves valid relayErrors on early return and drops invalid, removed, or skipped owners', async () => {
    const scopes = [
      { owner: 'example-org', kind: 'org', repos: '*', mode: 'enforce' },
      { owner: 'example-team', kind: 'org', repos: ['team-repo'], excludeForks: true },
      { owner: 'example-other', kind: 'org', repos: '*', mode: 'report' },
    ]
    const loop = await makeLoop({ scopes })
    await seedLast(loop.stateDir, {
      'Example-Team': 2,
      'example-other': 1,
      'example-org': 0,
      'removed-owner': 3,
    })
    await loop.seed({ watches: [{ id: 'w1', prs: [], notify: 's', note: 'done' }] })
    const early = await loop.cli(['wait'], makeWorld().run, undefined, makeWorld().io)
    expect(early.code).toBe(0)
    // Keys are normalized to lowercase and sorted deterministically.
    expect(lines(early.stdout)[0]).toEqual({
      gap: false,
      events: 1,
      relayErrors: { 'example-other': 1, 'example-team': 2 },
    })
    expect(Object.keys(lines(early.stdout)[0]!.relayErrors)).toEqual([
      'example-other',
      'example-team',
    ])

    // Remove the watch and verify: non-integer count ignored, skipped owner (no repos) pruned,
    // while an active owner in failures stays counted.
    await loop.seed({ watches: [] })
    await seedLast(loop.stateDir, {
      'example-team': 2,
      'example-other': 1,
      'example-org': 1.5,
    })
    const world = makeWorld({
      replies: (req) => {
        if (req.owner === 'example-other') return { status: 503 }
        return { events: [actionable('f-active')] }
      },
    })
    const baseRun = world.run
    world.run = async (command, args, options) => {
      if (command === 'gh' && args[1] === '--paginate' && args[2]!.startsWith('orgs/example-team'))
        return { code: 0, stdout: 'forked\ttrue\n', stderr: '' }
      return await baseRun(command, args, options)
    }
    const polled = await loop.cli(['wait'], world.run, undefined, world.io)
    expect(polled.code).toBe(0)
    const jsonLines = polled.stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line))
    // example-team was skipped (no matching repos) so its carried count was pruned;
    // example-other stayed active and incremented from 1 to 2.
    expect(jsonLines[0]).toEqual({
      gap: false,
      events: 1,
      relayErrors: { 'example-other': 2 },
    })
  })
})
