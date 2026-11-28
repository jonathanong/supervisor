import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop } from './helpers/loop.js'
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
  event: 'workflow_run',
  action: 'completed',
  conclusion: 'failure',
  headRef: 'main',
})
const REFUSAL =
  'supervisor wait: hh-last.json holds events that were not advanced; ' +
  'run "supervisor state advance-hh" first\n'

async function leave(stateDir: string, text: string): Promise<void> {
  await mkdir(stateDir, { recursive: true })
  await writeFile(join(stateDir, 'hh-last.json'), text, 'utf8')
}

describe('supervisor wait over a result that was not advanced', () => {
  afterEach(cleanupLoops)

  it('refuses with exit 4 and runs nothing until advance-hh, then starts', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const c1 = encodeCursor({ v: 1, sk: '1767323045001#1', seen: ['e1'] })
    await leave(loop.stateDir, JSON.stringify({ events: [failure], cursor: c1 }))
    const world = makeWorld({ replies: [{ events: [], timedOut: true }] })
    const refused = await loop.cli(WAIT, world.run, undefined, world.io)
    expect(refused).toEqual({ code: 4, stdout: '', stderr: REFUSAL })
    expect(world.calls).toEqual([])
    expect(world.requests).toEqual([])

    expect((await loop.cli(['state', 'advance-hh'])).code).toBe(0)
    const started = await loop.cli(WAIT, world.run, undefined, world.io)
    expect(started.code).toBe(0)
    expect(world.requests[0]!.after).toBe('1767323045001#1')
  })

  it('does not refuse an absent file, one with no events, or ids already seen', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const replies = Array.from({ length: 4 }, () => ({ events: [], timedOut: true }))
    const world = makeWorld({ replies })
    expect((await loop.cli(WAIT, world.run, undefined, world.io)).code).toBe(0)
    await leave(loop.stateDir, JSON.stringify({ events: [], cursor: 'c9', timedOut: true }))
    expect((await loop.cli(WAIT, world.run, undefined, world.io)).code).toBe(0)
    await leave(loop.stateDir, JSON.stringify({ events: [{ repo: 'x' }, 'junk'] }))
    expect((await loop.cli(WAIT, world.run, undefined, world.io)).code).toBe(0)
    await leave(loop.stateDir, JSON.stringify({ cursor: 'c9' }))
    expect((await loop.cli(WAIT, world.run, undefined, world.io)).code).toBe(0)
    await leave(loop.stateDir, JSON.stringify({ events: [failure] }))
    await loop.seed({ hookHarness: { seen: ['e1'] } })
    const again = makeWorld({ replies: [{ events: [], timedOut: true }] })
    expect((await loop.cli(WAIT, again.run, undefined, again.io)).code).toBe(0)
  })

  it('does not refuse a file that is not an object, and exits 1 for one that is not JSON', async () => {
    const loop = await makeLoop(ORG_ONLY)
    await leave(loop.stateDir, '[]')
    const world = makeWorld({ replies: [{ events: [], timedOut: true }] })
    expect((await loop.cli(WAIT, world.run, undefined, world.io)).code).toBe(0)
    await leave(loop.stateDir, 'not json')
    const broken = await loop.cli(WAIT, world.run, undefined, world.io)
    expect(broken.code).toBe(1)
  })

  it('exits 1 when the result file cannot be read', async () => {
    const loop = await makeLoop(ORG_ONLY)
    await mkdir(join(loop.stateDir, 'hh-last.json'), { recursive: true })
    const result = await loop.cli(WAIT, makeWorld().run)
    expect(result.code).toBe(1)
  })

  it('lets a wait that advances itself start again without a manual step', async () => {
    const loop = await makeLoop({ ...ORG_ONLY, eventWait: { advance: true } })
    const world = makeWorld({
      replies: [
        { events: [failure], cursor: '1767323045001#1' },
        { events: [], cursor: '1767323045002#2', timedOut: true },
      ],
    })
    const first = await loop.cli(WAIT, world.run, undefined, world.io)
    expect(lines(first.stdout)[0]).toEqual({ gap: false, events: 1, advanced: true })
    const state = await loop.state()
    expect(state.hookHarness.seen).toEqual(['e1'])
    expect(decodeCursor(state.hookHarness.cursor).sk).toBe('1767323045001#1')
    const second = await loop.cli(WAIT, world.run, undefined, world.io)
    expect(second.code).toBe(0)
    expect(world.requests[1]!.after).toBe('1767323045001#1')
  })

  it('does not check an old result file when the wait advances itself', async () => {
    const loop = await makeLoop({ ...ORG_ONLY, eventWait: { advance: true } })
    await leave(loop.stateDir, JSON.stringify({ events: [failure], cursor: 'c1' }))
    const world = makeWorld({ replies: [{ events: [], timedOut: true }] })
    expect((await loop.cli(WAIT, world.run, undefined, world.io)).code).toBe(0)
    const flag = await makeLoop(ORG_ONLY)
    await leave(flag.stateDir, JSON.stringify({ events: [failure], cursor: 'c1' }))
    const again = makeWorld({ replies: [{ events: [], timedOut: true }] })
    expect((await flag.cli([...WAIT, '--advance'], again.run, undefined, again.io)).code).toBe(0)
  })

  it('drops returned events whose id is already seen, and keeps waiting', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const c0 = encodeCursor({ v: 1, sk: '1767323000000#0', seen: [] })
    await loop.seed({ hookHarness: { seen: ['e1', 'm1'], cursor: c0 } })
    const world = makeWorld({
      replies: [
        { events: [failure, mergeEvent('m1', 'example-repo', 4)], cursor: '1767323045001#1' },
        { events: [], cursor: '1767323045002#2', timedOut: true },
      ],
    })
    const result = await loop.cli(WAIT, world.run, undefined, world.io)
    expect(lines(result.stdout)).toEqual([{ gap: false, timedOut: true, events: 0 }])
    expect(world.requests[1]!.after).toBe('1767323045001#1')
  })
})
