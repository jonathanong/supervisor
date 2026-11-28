import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop, NOW } from './helpers/loop.js'
import { makeWorld, mergeEvent, ORG_ONLY } from './helpers/wait.js'

const WAIT = ['wait']
const STATUS = ['stop', '--status']

describe('supervisor stop and resume', () => {
  afterEach(cleanupLoops)

  it('prints help without a config and is listed in the main help', async () => {
    const loop = await makeLoop(ORG_ONLY)
    loop.env.SUPERVISOR_CONFIG = '/nonexistent/config.json'
    for (const args of [['stop', '--help'], ['resume', '-h'], STATUS.concat('-h')]) {
      const help = await loop.cli(args)
      expect(help.code).toBe(0)
      expect(help.stdout).toMatch(/^Usage: supervisor stop \[--reason <text>\]\n/)
    }
    const main = (await loop.cli(['--help'])).stdout
    expect(main).toContain('  stop [--reason <text>] ')
    expect(main).toContain('  stop --status ')
    expect(main).toContain('  resume ')
    expect(await loop.cli(STATUS)).toMatchObject({ code: 1, stdout: '' })
  })

  it('creates the stop file with the time and the reason, reports it, and removes it', async () => {
    const loop = await makeLoop(ORG_ONLY)
    expect(await loop.cli(STATUS)).toEqual({ code: 0, stdout: '{"stopped": false}\n', stderr: '' })
    const record = `{"at": "${NOW}", "reason": "CI is broken everywhere"}`
    expect(await loop.cli(['stop', '--reason', 'CI is broken everywhere'])).toEqual({
      code: 0,
      stdout: `{"stopped": true, "at": "${NOW}", "reason": "CI is broken everywhere"}\n`,
      stderr: '',
    })
    const path = join(loop.stateDir, 'stop')
    expect(await readFile(path, 'utf8')).toBe(`${record}\n`)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await loop.cli(STATUS)).toEqual({
      code: 3,
      stdout: `{"stopped": true, "at": "${NOW}", "reason": "CI is broken everywhere"}\n`,
      stderr: '',
    })
    expect(await loop.cli(['resume'])).toEqual({
      code: 0,
      stdout: `{"stopped": false, "was": ${record}}\n`,
      stderr: '',
    })
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await loop.cli(STATUS)).code).toBe(0)
    expect((await loop.cli(['resume'])).stdout).toBe('{"stopped": false, "was": null}\n')
  })

  it('records no reason when none is given, and a second stop replaces the first', async () => {
    const loop = await makeLoop(ORG_ONLY)
    await loop.cli(['stop', '--reason', 'first'])
    const later = '2026-02-03T04:05:06Z'
    const second = await loop.cli(['stop'], undefined, () => new Date(later))
    expect(second.stdout).toBe(`{"stopped": true, "at": "${later}", "reason": null}\n`)
    expect((await loop.cli(STATUS)).stdout).toBe(second.stdout)
  })

  it('treats anything a person put at the path as a stop', async () => {
    const loop = await makeLoop(ORG_ONLY)
    await mkdir(loop.stateDir, { recursive: true })
    const path = join(loop.stateDir, 'stop')
    const unexplained = { code: 3, stdout: '{"stopped": true, "at": null, "reason": null}\n' }
    for (const content of ['', 'stop please', '[1]', '{"at": 5, "reason": ""}']) {
      await writeFile(path, content)
      expect(await loop.cli(STATUS)).toMatchObject(unexplained)
    }
    await loop.cli(['resume'])
    await mkdir(join(path, 'nested'), { recursive: true })
    expect(await loop.cli(STATUS)).toMatchObject(unexplained)
    const refused = await loop.cli(['state', 'sweep-start', '--id', 'a'])
    expect(refused.stderr).toBe(
      `supervisor state sweep-start: stopped by ${path}; "supervisor resume" clears it\n`,
    )
    expect((await loop.cli(['stop', '--reason', 'r'])).code).toBe(0)
    expect((await loop.cli(['resume'])).stdout).toContain('"reason": "r"')
    expect((await loop.cli(STATUS)).code).toBe(0)
  })

  it('exits 2 with help for arguments it cannot accept', async () => {
    const loop = await makeLoop(ORG_ONLY)
    for (const args of [
      [...STATUS, '--reason', 'x'],
      ['stop', '--nope'],
      ['resume', 'now'],
    ]) {
      const result = await loop.cli(args)
      expect(result).toMatchObject({ code: 2, stdout: '' })
      expect(result.stderr).toMatch(/^supervisor (stop|resume): .+\nUsage: supervisor stop /)
    }
    await expect(stat(join(loop.stateDir, 'stop'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('needs no state lock: a held lock blocks neither a stop nor a refusal', async () => {
    const loop = await makeLoop(ORG_ONLY)
    await mkdir(loop.stateDir, { recursive: true })
    await writeFile(join(loop.stateDir, 'state.lock'), `${process.pid} held-by-this-test`)
    expect((await loop.cli(['stop', '--reason', 'stuck lock'])).code).toBe(0)
    expect((await loop.cli(STATUS)).code).toBe(3)
    expect((await loop.cli(['state', 'sweep-start', '--id', 'a'])).code).toBe(3)
    expect((await loop.cli(WAIT)).code).toBe(3)
    expect((await loop.cli(['resume'])).code).toBe(0)
    expect((await loop.cli(STATUS)).code).toBe(0)
  })
})

describe('the stop switch in state and wait', () => {
  afterEach(cleanupLoops)

  it('refuses sweep-start with one line and exit 3, and still records facts', async () => {
    const loop = await makeLoop(ORG_ONLY)
    await loop.cli(['state', 'sweep-start', '--id', 'earlier'])
    await loop.cli(['stop', '--reason', 'pause'])
    expect(await loop.cli(['state', 'sweep-start', '--id', 'next'])).toEqual({
      code: 3,
      stdout: '',
      stderr:
        `supervisor state sweep-start: stopped by ${join(loop.stateDir, 'stop')} since ${NOW} ` +
        '(pause); "supervisor resume" clears it\n',
    })
    expect((await loop.state()).sweep.id).toBe('earlier')

    expect((await loop.cli(['state', 'route', '--what', 'saw x', '--to', 'nobody'])).code).toBe(0)
    expect((await loop.cli(['state', 'set', 'escalations.k', '--json', '"t"'])).code).toBe(0)
    expect((await loop.cli(['state', 'sweep-done'])).code).toBe(0)
    expect(await loop.state()).toMatchObject({ escalations: { k: 't' }, lastSweepAt: NOW })
    expect((await loop.state()).routed).toHaveLength(1)

    await loop.cli(['resume'])
    expect((await loop.cli(['state', 'sweep-start', '--id', 'next'])).code).toBe(0)
  })

  it('does not start a wait while stopped: one line, exit 3, and nothing is run', async () => {
    const loop = await makeLoop(ORG_ONLY)
    await loop.cli(['stop'])
    const world = makeWorld()
    expect(await loop.cli(WAIT, world.run)).toEqual({
      code: 3,
      stdout: '',
      stderr:
        `supervisor wait: stopped by ${join(loop.stateDir, 'stop')} since ${NOW}; ` +
        '"supervisor resume" clears it\n',
    })
    expect(world.calls).toEqual([])
    await expect(stat(join(loop.stateDir, 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('ends a wait in progress when the stop appears between two rounds', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const quiet = { events: [mergeEvent('m1', 'example-repo', 5)], cursor: 'c1' }
    let stopping: Promise<unknown> | undefined
    const world = makeWorld({
      results: [quiet, quiet],
      onWait: () => {
        stopping = loop.cli(['stop', '--reason', 'mid-wait'])
      },
    })
    const result = await loop.cli(WAIT, async (...call) => {
      const done = await world.run(...call)
      await stopping
      return done
    })
    expect(result).toMatchObject({ code: 3, stdout: '' })
    expect(result.stderr).toContain('(mid-wait)')
    expect(world.waits()).toHaveLength(1)
    const state = await loop.state()
    expect(state.quietMerges).toEqual(['example-org/example-repo#5'])
    expect(state.hookHarness.cursor).toBe('c1')
  })

  it('still returns the events of a round that was running when the stop appeared', async () => {
    const loop = await makeLoop(ORG_ONLY)
    const failed = { id: 'e1', repo: 'example-repo', event: 'workflow_run', action: 'completed' }
    let stopping: Promise<unknown> | undefined
    const world = makeWorld({
      results: [{ events: [failed], cursor: 'c1' }],
      onWait: () => {
        stopping = loop.cli(['stop'])
      },
    })
    const result = await loop.cli(WAIT, async (...call) => {
      const done = await world.run(...call)
      await stopping
      return done
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('"id":"e1"')
    expect((await loop.cli(STATUS)).code).toBe(3)
  })
})
