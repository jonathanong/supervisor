import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { runProcess } from '../src/state/process.js'
import { compact } from '../src/wait/events.js'
import { cleanupLoops, makeLoop } from './helpers/loop.js'
import { envelope, lines, makeWorld, ORG_ONLY } from './helpers/wait.js'

const WAIT = ['wait']

describe('supervisor wait: command line and events', () => {
  afterEach(cleanupLoops)

  it('prints help without a config and lists wait in the main help', async () => {
    const loop = await makeLoop(ORG_ONLY)
    loop.env.SUPERVISOR_CONFIG = '/nonexistent/config.json'
    for (const flag of ['--help', '-h']) {
      const help = await loop.cli(['wait', flag])
      expect(help.code).toBe(0)
      expect(help.stdout).toMatch(/^Usage: supervisor wait \[--advance\]\n/)
      expect(help.stdout).not.toContain('--owner <owner>')
    }
    expect((await loop.cli(['--help'])).stdout).toContain('  wait [--advance]')
  })

  it('rejects --owner in one line, and an unknown option with help, both exit 2', async () => {
    const loop = await makeLoop(ORG_ONLY)
    for (const args of [
      ['--owner', 'example-org'],
      ['--owner=example-org'],
      ['--advance', '--owner'],
    ]) {
      expect(await loop.cli(['wait', ...args])).toEqual({
        code: 2,
        stdout: '',
        stderr: 'supervisor wait: --owner was removed; the wait now covers every owner in scopes\n',
      })
    }
    const unknown = await loop.cli(['wait', '--nope'])
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toMatch(/^supervisor wait: .+\nUsage: supervisor wait /)
  })

  it('exits 1 for a duration it cannot read', async () => {
    const loop = await makeLoop(ORG_ONLY)
    loop.env.HH_TIMEOUT = 'soon'
    expect(await loop.cli(WAIT)).toEqual({
      code: 1,
      stdout: '',
      stderr: "supervisor wait: duration 'soon' must look like 90s, 10m, or 2h\n",
    })
  })

  it('returns at once when the oldest pending update check is due', async () => {
    const loop = await makeLoop(ORG_ONLY)
    await loop.seed({
      pendingUpdateChecks: [
        { repo: 'example-org/other-repo', at: '2026-01-02T03:00:00Z' },
        { repo: 'Example-Org/example-repo', at: '2026-01-02T02:54:05Z' },
        { repo: 'example-user/demo-repo', at: '2026-01-01T00:00:00Z' },
      ],
    })
    const world = makeWorld()
    expect(
      lines((await loop.cli([...WAIT, '--advance'], world.run, undefined, world.io)).stdout),
    ).toEqual([
      {
        gap: false,
        events: 0,
        pendingUpdateChecks: [
          'Example-Org/example-repo',
          'example-org/other-repo',
          'example-user/demo-repo',
        ],
        updateCheckDue: true,
        advanced: true,
      },
    ])
    expect(world.calls).toEqual([])
    expect(world.requests).toEqual([])
  })

  it('does not shorten the wait for a check that is due after the timeout or has no time', async () => {
    const loop = await makeLoop(ORG_ONLY)
    loop.env.HH_TIMEOUT = '1m'
    await loop.seed({
      pendingUpdateChecks: [{ repo: 'example-org/other-repo', at: '2026-01-02T03:04:05Z' }],
    })
    const later = makeWorld({ replies: [{ events: [], timedOut: true }] })
    const [summary] = lines((await loop.cli(WAIT, later.run, undefined, later.io)).stdout)
    expect(summary).toEqual({
      gap: false,
      timedOut: true,
      events: 0,
      pendingUpdateChecks: ['example-org/other-repo'],
    })
    expect(later.timeouts).toEqual([60_000])

    await loop.seed({ pendingUpdateChecks: [{ repo: 'example-org/other-repo' }] })
    const undated = makeWorld({ replies: [{ events: [], timedOut: true }] })
    await loop.cli(WAIT, undated.run, undefined, undated.io)
    expect(undated.timeouts).toEqual([60_000])
  })

  it('prints only the fields the loop uses, and never an empty one', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const events = [
      envelope({
        id: 'a',
        repo: null,
        event: 'issue_comment',
        action: 'created',
        command: '/fix',
        commentId: 9,
        issue: 3,
        headRef: null,
        conclusion: null,
        workflow: null,
        runId: null,
        sender: { login: 'example-user', type: 'User' },
        headSha: 'abc',
        extra: 'x',
      }),
      envelope({
        id: 'b',
        repo: null,
        event: 'pull_request',
        action: 'closed',
        headRef: null,
        conclusion: null,
        workflow: null,
        runId: null,
        sender: {},
        payload: { pull_request: { merged: false } },
      }),
      envelope({
        id: 'c',
        repo: null,
        event: 'pull_request',
        action: 'dequeued',
        reason: 'CI_FAILURE',
        headRef: null,
        conclusion: null,
        workflow: null,
        runId: null,
        sender: null,
        payload: 'text',
      }),
    ]
    const world = makeWorld({ replies: [{ events }] })
    expect(lines((await loop.cli(WAIT, world.run, undefined, world.io)).stdout).slice(1)).toEqual([
      {
        id: 'a',
        event: 'issue_comment',
        action: 'created',
        issue: 3,
        command: '/fix',
        commentId: 9,
        headSha: 'abc',
        sender: 'example-user',
      },
      { id: 'b', event: 'pull_request', action: 'closed', sender: null, merged: false },
      { id: 'c', event: 'pull_request', action: 'dequeued', reason: 'CI_FAILURE' },
    ])
    expect(
      compact({ id: 'd', event: 'push', sender: 'text', payload: { pull_request: {} } }),
    ).toEqual({
      id: 'd',
      event: 'push',
      sender: null,
    })
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
