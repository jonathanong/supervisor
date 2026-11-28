import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop } from './helpers/loop.js'
import { decodeCursor, envelope, lines, makeWorld, ORG_ONLY } from './helpers/wait.js'

const WAIT = ['wait']

describe('supervisor wait: hook-harness client errors, gaps, and timeouts', () => {
  afterEach(cleanupLoops)

  it('maps NotLoggedInError to a configuration error and exits 1', async () => {
    const loop = await makeLoop(ORG_ONLY)
    delete loop.env.HOOK_HARNESS_URL
    delete loop.env.HOOK_HARNESS_TOKEN
    const world = makeWorld()
    const result = await loop.cli(WAIT, world.run, undefined, world.io)
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(
      /^supervisor wait: hook-harness configuration error: not logged in/,
    )
    expect(world.requests).toEqual([])
  })

  it('maps non-https and invalid relay URLs to configuration errors before calling fetch', async () => {
    const loop = await makeLoop(ORG_ONLY)
    for (const url of ['http://relay.example.test', 'ftp://relay.example.test', 'not-a-url']) {
      loop.env.HOOK_HARNESS_URL = url
      const world = makeWorld()
      // Omit world.io on the first check to also verify default fetch/timeoutSignal plumbing.
      const extra = url === 'http://relay.example.test' ? undefined : world.io
      const result = await loop.cli(WAIT, world.run, undefined, extra)
      expect(result.code).toBe(1)
      expect(result.stderr).toMatch(/^supervisor wait: hook-harness configuration error: /)
      expect(world.requests).toEqual([])
    }
  })

  it('maps a TypeError after the first batch to a generic error, not a configuration error', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const world = makeWorld({ replies: [{ events: [] }] })
    const sleep = async (): Promise<void> => {
      throw new TypeError('undefined is not a function')
    }
    const result = await loop.cli(WAIT, world.run, undefined, { ...world.io, sleep })
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/^supervisor wait: hook-harness error: undefined is not/)
  })

  it('allows http: only for loopback relay hosts', async () => {
    const loop = await makeLoop(ORG_ONLY)
    for (const url of ['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787']) {
      loop.env.HOOK_HARNESS_URL = url
      const world = makeWorld({ replies: [{ events: [], timedOut: true }] })
      const result = await loop.cli(WAIT, world.run, undefined, world.io)
      expect(result.code).toBe(0)
      expect(world.requests).toHaveLength(1)
    }
  })

  it('maps UnauthorizedError, OutOfScopeError, BadRequestError, and bad stored cursor to exit 1', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const unauth = makeWorld({ replies: [{ status: 401 }] })
    const r401 = await loop.cli(WAIT, unauth.run, undefined, unauth.io)
    expect(r401.code).toBe(1)
    expect(r401.stderr).toMatch(/^supervisor wait: hook-harness token rejected: .*HTTP 401/)

    const outOfScope = makeWorld({
      replies: [{ status: 403, body: { scopes: ['other-org/*'] } }],
    })
    const r403 = await loop.cli(WAIT, outOfScope.run, undefined, outOfScope.io)
    expect(r403.code).toBe(1)
    expect(r403.stderr).toMatch(
      /^supervisor wait: hook-harness token out of scope: .*example-org.*other-org\/\*/,
    )

    const badReq = makeWorld({ replies: [{ status: 400, body: { error: 'bad filters' } }] })
    const r400 = await loop.cli(WAIT, badReq.run, undefined, badReq.io)
    expect(r400.code).toBe(1)
    expect(r400.stderr).toMatch(/^supervisor wait: hook-harness bad request: .*bad filters/)

    await loop.seed({ hookHarness: { cursor: 'not-valid-base64-cursor' } })
    const badCursor = makeWorld()
    const rCursor = await loop.cli(WAIT, badCursor.run, undefined, badCursor.io)
    expect(rCursor.code).toBe(1)
    expect(rCursor.stderr).toMatch(/^supervisor wait: hook-harness error: invalid cursor:/)
    expect(badCursor.requests).toEqual([])
  })

  it('retries transient relay errors and fails after a sustained run of error batches', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const event = envelope({ id: 'ok1', repo: 'example-org/example-repo' })
    const recovering = makeWorld({
      replies: [
        { status: 503 },
        new TypeError('fetch failed'),
        { events: [] },
        { status: 502 },
        { events: [event], cursor: '1767323045010#ok' },
      ],
    })
    const ok = await loop.cli([...WAIT, '--advance'], recovering.run, undefined, recovering.io)
    expect(ok.code).toBe(0)
    expect(lines(ok.stdout)[0]).toEqual({ gap: false, events: 1, advanced: true })
    expect(recovering.requests).toHaveLength(5)

    const down = makeWorld({
      replies: Array.from({ length: 5 }, () => ({ status: 503 })),
    })
    const failed = await loop.cli(WAIT, down.run, undefined, down.io)
    expect(failed.code).toBe(1)
    expect(failed.stderr).toMatch(
      /^supervisor wait: hook-harness relay unreachable \(5 consecutive errors for example-org\): .*HTTP 503/,
    )
    expect(down.requests).toHaveLength(5)
  })

  it('returns immediately on gap: true and preserves cursor', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const world = makeWorld({
      replies: [{ events: [], gap: true, cursor: '1767323045055#gap' }],
    })
    const result = await loop.cli(WAIT, world.run, undefined, world.io)
    expect(result.code).toBe(0)
    expect(lines(result.stdout)).toEqual([{ gap: true, events: 0 }])
    const saved = JSON.parse(await readFile(join(loop.stateDir, 'hh-last.json'), 'utf8'))
    expect(saved.gap).toBe(true)
    expect(decodeCursor(saved.cursor).sk).toBe('1767323045055#gap')
  })

  it('ends cleanly as timedOut without error when the abort signal fires mid-request', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const world = makeWorld({ replies: ['abort'] })
    const result = await loop.cli(WAIT, world.run, undefined, world.io)
    expect(result).toEqual({
      code: 0,
      stdout: '{"gap":false,"timedOut":true,"events":0}\n',
      stderr: '',
    })
    const saved = JSON.parse(await readFile(join(loop.stateDir, 'hh-last.json'), 'utf8'))
    expect(saved).toEqual({ events: [], gap: false, timedOut: true })
  })

  it('exits 1 when no repositories match or gh fails', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const none = await loop.cli(WAIT, makeWorld({ listing: 'archived-repo\tfalse\n' }).run)
    expect(none).toMatchObject({
      code: 1,
      stderr: 'supervisor wait: no repositories match the configuration\n',
    })
    const denied = await loop.cli(WAIT, async () => ({
      code: 1,
      stdout: '',
      stderr: ' HTTP 404\n',
    }))
    expect(denied.stderr).toBe('supervisor wait: gh exited 1: HTTP 404\n')
  })

  it('returns at the timeout without polling, reporting watches that are complete', async () => {
    const loop = await makeLoop(ORG_ONLY)
    await loop.seed({ watches: [{ id: 'w', prs: [], notify: 's', note: 'go' }, {}] })
    const world = makeWorld()
    expect(lines((await loop.cli(WAIT, world.run, undefined, world.io)).stdout)[0]).toEqual({
      gap: false,
      events: 2,
    })
    loop.env.HH_TIMEOUT = '1s'
    const times = [0]
    const timed = await loop.cli(WAIT, world.run, () => new Date(times.shift() ?? 2000), world.io)
    expect(lines(timed.stdout)).toEqual([
      { gap: false, timedOut: true, events: 2 },
      { event: 'watch', id: 'w', notify: 's', note: 'go', prs: [] },
      { event: 'watch', id: null, notify: null, note: '', prs: [] },
    ])
    expect(world.calls).toEqual([])
    expect(world.requests).toEqual([])
  })
})
