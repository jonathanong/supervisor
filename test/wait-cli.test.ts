import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { runProcess } from '../src/state/process.js'
import { cleanupLoops, makeLoop } from './helpers/loop.js'
import { lines, makeWorld } from './helpers/wait.js'

const WAIT = ['wait', '--owner', 'example-org']

describe('supervisor wait: command line and events', () => {
  afterEach(cleanupLoops)

  it('prints help without a config and lists wait in the main help', async () => {
    const loop = await makeLoop()
    loop.env.SUPERVISOR_CONFIG = '/nonexistent/config.json'
    for (const flag of ['--help', '-h']) {
      const help = await loop.cli(['wait', flag])
      expect(help.code).toBe(0)
      expect(help.stdout).toMatch(/^Usage: supervisor wait --owner <owner> \[--advance\]\n/)
    }
    expect((await loop.cli(['--help'])).stdout).toContain('  wait --owner <owner> [--advance]')
  })

  it('exits 2 with help for a missing or malformed owner or an unknown option', async () => {
    const loop = await makeLoop()
    for (const args of [[], ['--owner', 'bad/owner'], ['--owner', 'example-org', '--nope']]) {
      const result = await loop.cli(['wait', ...args])
      expect(result.code).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toMatch(/^supervisor wait: .+\nUsage: supervisor wait /)
    }
  })

  it('exits 1 for an owner without a scope or a duration it cannot read', async () => {
    const loop = await makeLoop()
    const unknown = await loop.cli(['wait', '--owner', 'nobody'])
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toContain('nobody')
    loop.env.HH_TIMEOUT = 'soon'
    expect(await loop.cli(WAIT)).toEqual({
      code: 1,
      stdout: '',
      stderr: "supervisor wait: duration 'soon' must look like 90s, 10m, or 2h\n",
    })
  })

  it('returns at once when this owner’s oldest pending update check is due', async () => {
    const loop = await makeLoop()
    await loop.seed({
      pendingUpdateChecks: [
        { repo: 'example-org/other-repo', at: '2026-01-02T03:00:00Z' },
        { repo: 'Example-Org/example-repo', at: '2026-01-02T02:54:05Z' },
        { repo: 'example-user/demo-repo', at: '2026-01-01T00:00:00Z' },
      ],
    })
    const world = makeWorld()
    expect(lines((await loop.cli([...WAIT, '--advance'], world.run)).stdout)).toEqual([
      {
        gap: false,
        events: 0,
        pendingUpdateChecks: ['Example-Org/example-repo', 'example-org/other-repo'],
        updateCheckDue: true,
        advanced: true,
      },
    ])
    expect(world.calls).toEqual([])
  })

  it('does not shorten the wait for a check that is due after the timeout or has no time', async () => {
    const loop = await makeLoop()
    loop.env.HH_TIMEOUT = '1m'
    await loop.seed({
      pendingUpdateChecks: [{ repo: 'example-org/other-repo', at: '2026-01-02T03:04:05Z' }],
    })
    const later = makeWorld({ results: [{ events: [], timedOut: true }] })
    const [summary] = lines((await loop.cli(WAIT, later.run)).stdout)
    expect(summary).toEqual({
      timedOut: true,
      events: 0,
      pendingUpdateChecks: ['example-org/other-repo'],
    })
    expect(later.waits()[0]!.at(-1)).toBe('1m')

    await loop.seed({ pendingUpdateChecks: [{ repo: 'example-org/other-repo' }] })
    const undated = makeWorld({ results: [{ events: [] }] })
    await loop.cli(WAIT, undated.run)
    expect(undated.waits()[0]!.at(-1)).toBe('1m')
  })

  it('prints only the fields the loop uses, and never an empty one', async () => {
    const loop = await makeLoop()
    const events = [
      {
        id: 'a',
        event: 'issue_comment',
        command: '/fix',
        commentId: 9,
        issue: 3,
        sender: 'text',
        headSha: 'abc',
        extra: 'x',
      },
      {
        id: 'b',
        event: 'pull_request',
        action: 'closed',
        sender: {},
        payload: { pull_request: { merged: false } },
      },
      { id: 'c', event: 'pull_request', action: 'opened', reason: 'dequeued', payload: 'text' },
      { id: 'd', event: 'push', payload: { pull_request: { merged: true } } },
    ]
    const world = makeWorld({ results: [{ events }] })
    expect(lines((await loop.cli(WAIT, world.run)).stdout).slice(1)).toEqual([
      {
        id: 'a',
        event: 'issue_comment',
        issue: 3,
        command: '/fix',
        commentId: 9,
        headSha: 'abc',
        sender: null,
      },
      { id: 'b', event: 'pull_request', action: 'closed', sender: null, merged: false },
      { id: 'c', event: 'pull_request', action: 'opened', reason: 'dequeued' },
      { id: 'd', event: 'push' },
    ])
  })

  it('runs a process in a directory and can leave its stderr uncaptured', async () => {
    const script = 'process.stdout.write(process.cwd())'
    const here = await realpath(tmpdir())
    const result = await runProcess(process.execPath, ['-e', script], {
      cwd: here,
      inheritStderr: true,
    })
    expect(result).toEqual({ code: 0, stdout: here, stderr: '' })
  })
})
