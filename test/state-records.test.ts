import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop, NOW } from './helpers/loop.js'

describe('supervisor state record subcommands', () => {
  afterEach(cleanupLoops)

  it('records a route with only the optional fields that were given', async () => {
    const loop = await makeLoop()
    const plain = await loop.cli(['state', 'route', '--what', 'flaky test', '--to', 'worker'])
    expect(plain.stdout).toBe(`{"what": "flaky test", "to": "worker", "at": "${NOW}"}\n`)
    const full = ['--evidence', 'run 7', '--issue', 'example-org/example-repo#3', '--note', 'n']
    await loop.cli(['state', 'route', '--what', 'slow job', '--to', 'agent', ...full])
    expect((await loop.state()).routed[1]).toEqual({
      what: 'slow job',
      to: 'agent',
      at: NOW,
      evidence: 'run 7',
      issue: 'example-org/example-repo#3',
      note: 'n',
    })
    expect((await loop.cli(['state', 'route', '--what', 'x'])).code).toBe(2)
    expect((await loop.cli(['state', 'route', '--to', 'x'])).stderr).toContain('--what is required')
    expect((await loop.cli(['state', 'route', '--bogus'])).code).toBe(2)
  })

  it('annotates the one route that matches and refuses none or several', async () => {
    const loop = await makeLoop()
    expect(
      (await loop.cli(['state', 'annotate-route', '--match', 'x', '--note', 'n'])).stderr,
    ).toBe("annotate-route: 0 entries match 'x'; need exactly 1\n")
    await loop.seed({
      routed: [{ what: 'flaky test' }, { what: 'flaky build' }, 'junk', { to: 1 }],
    })
    const several = await loop.cli(['state', 'annotate-route', '--match', 'flaky', '--note', 'n'])
    expect(several).toMatchObject({ code: 1, stderr: expect.stringContaining('2 entries match') })
    const one = await loop.cli(['state', 'annotate-route', '--match', 'build', '--note', 'fixed'])
    expect(one.stdout).toBe('{"what": "flaky build", "note": "fixed"}\n')
    await loop.cli(['state', 'annotate-route', '--match', 'test', '--note', 'n', '--issue', 'i#1'])
    expect((await loop.state()).routed[0]).toEqual({ what: 'flaky test', note: 'n', issue: 'i#1' })
  })

  it('records scheduled-prompt runs, bounded by the configured history', async () => {
    const loop = await makeLoop({ scheduledPrompts: { history: 2 } })
    const record = (prompt: string, extra: string[] = []) =>
      loop.cli([
        'state',
        'sp-record',
        ...extra,
        '--prompt',
        prompt,
        '--run-id',
        `run-${prompt}`,
        '--outcome',
        'pr',
        '--next',
        'b',
      ])
    expect((await record('a')).stdout).toBe(
      `{"recorded": {"prompt": "a", "runId": "run-a", "at": "${NOW}", "outcome": "pr"}, "next": "b"}\n`,
    )
    await record('b', ['--pr', 'example-org/example-repo#9'])
    await record('c')
    const { scheduledPrompts } = await loop.state()
    expect(scheduledPrompts.runs.map((run: { prompt: string }) => run.prompt)).toEqual(['b', 'c'])
    expect(scheduledPrompts.runs[0].pr).toBe('example-org/example-repo#9')
    expect((await loop.cli(['state', 'sp-next', '--next', 'z'])).stdout).toBe('{"next": "z"}\n')
    expect((await loop.state()).scheduledPrompts.next).toBe('z')
  })

  it('keeps twenty scheduled-prompt runs when the config sets no history', async () => {
    const loop = await makeLoop({ scheduledPrompts: undefined })
    await loop.seed({ scheduledPrompts: { runs: Array.from({ length: 25 }, (_, i) => i) } })
    const args = ['--prompt', 'a', '--run-id', 'r', '--outcome', 'none', '--next', 'a']
    await loop.cli(['state', 'sp-record', ...args])
    expect((await loop.state()).scheduledPrompts.runs).toHaveLength(20)
  })

  it('records and removes a shepherd and marks a sweep done', async () => {
    const loop = await makeLoop()
    const pr = 'example-org/example-repo#12'
    expect((await loop.cli(['state', 'shepherd', '--pr', pr])).stdout).toBe(
      `{"${pr}": {"by": "loop subagent", "since": "${NOW}", "head": null, "category": null}}\n`,
    )
    const named = ['--by', 'worker-1', '--head', 'abc123', '--category', 'flake-fix']
    await loop.cli(['state', 'shepherd', '--pr', pr, ...named])
    expect((await loop.state()).shepherds[pr]).toEqual({
      by: 'worker-1',
      since: NOW,
      head: 'abc123',
      category: 'flake-fix',
    })
    expect((await loop.cli(['state', 'shepherd', '--pr', pr, '--remove'])).stdout).toBe(
      `{"${pr}": null}\n`,
    )
    expect((await loop.state()).shepherds).toEqual({})

    expect((await loop.cli(['state', 'sweep-done'])).stdout).toBe(`{"lastSweepAt": "${NOW}"}\n`)
    expect((await loop.state()).lastSweepAt).toBe(NOW)
    expect((await loop.cli(['state', 'sweep-done', 'extra'])).code).toBe(2)
  })

  it('adds harvested comment ids per owner/repo once, whatever form they were stored in', async () => {
    const loop = await makeLoop()
    const file = join(loop.stateDir, '..', 'harvest.json')
    await loop.seed({ reviewedComments: { 'example-org/example-repo': [7, { id: '8' }] } })
    await writeFile(file, '{"example-org/example-repo": [7, "8", 9, 9], "example-user/other": [1]}')
    const added = await loop.cli(['state', 'reviewed', '--file', file])
    expect(added.stdout).toBe('{"example-org/example-repo": 3, "example-user/other": 1}\n')
    expect((await loop.state()).reviewedComments['example-org/example-repo'][2]).toEqual({
      id: 9,
      harvestedAt: NOW,
    })
  })

  it('refuses a harvest file keyed by a bare repository name or holding a non-id', async () => {
    const loop = await makeLoop()
    const file = join(loop.stateDir, '..', 'harvest.json')
    const reviewed = async (content: string) => {
      await writeFile(file, content)
      return (await loop.cli(['state', 'reviewed', '--file', file])).stderr
    }
    expect(await reviewed('{"example-repo": [1]}')).toBe(
      "reviewed: 'example-repo' must look like owner/repo\n",
    )
    expect(await reviewed('{"example-org/example-repo": ["abc"]}')).toContain('is not a comment id')
    expect(await reviewed('{"example-org/example-repo": [null]}')).toContain('is not a comment id')
    expect(await reviewed('{"example-org/example-repo": 5}')).toContain('must be array, got number')
    expect(await reviewed('[]')).toBe('state.json: reviewed --file must be object, got array\n')
    expect(await reviewed('{nope')).toContain(file)
    expect(await loop.cli(['state', 'reviewed', '--file', `${file}.missing`])).toMatchObject({
      code: 1,
      stderr: expect.stringContaining('ENOENT'),
    })
  })
})
