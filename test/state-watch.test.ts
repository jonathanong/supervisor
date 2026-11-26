import { afterEach, describe, expect, it } from 'vitest'
import type { RunProcess } from '../src/state/process.js'
import { graphqlReply, MERGED_AT, type PullFixture } from './helpers/gh.js'
import { cleanupLoops, done, makeLoop, NOW } from './helpers/loop.js'

const REF = 'example-org/example-repo#5'

function gh(pulls: Record<string, PullFixture>, calls: string[][] = []): RunProcess {
  return async (command, args) => {
    calls.push([command, ...args])
    const owner = args.find((arg) => arg.startsWith('o='))!.slice(2)
    const name = args.find((arg) => arg.startsWith('n='))!.slice(2)
    const number = args.find((arg) => arg.startsWith('p='))!.slice(2)
    return graphqlReply(args, pulls[`${owner}/${name}#${number}`]!)
  }
}

describe('supervisor state late-review', () => {
  afterEach(cleanupLoops)

  it('counts unresolved threads and non-empty reviews submitted after the merge', async () => {
    const loop = await makeLoop()
    const calls: string[][] = []
    const reviews = [
      { body: 'late finding', submittedAt: '2026-01-01T00:00:01Z' },
      { body: '  ', submittedAt: '2026-01-02T00:00:00Z' },
      { body: null, submittedAt: '2026-01-02T00:00:00Z' },
      { body: 'before merge', submittedAt: '2025-12-31T00:00:00Z' },
      { body: 'pending', submittedAt: null },
    ]
    const run = gh({ [REF]: { threads: [[true, false, false]], reviews: [reviews] } }, calls)
    const result = await loop.cli(['state', 'late-review', REF], run)
    expect(result).toEqual({
      code: 0,
      stdout: `${REF} MERGED mergedAt=${MERGED_AT} unresolved=2 late=1\n`,
      stderr: '',
    })
    expect(calls[0]!.slice(0, 4)).toEqual(['gh', 'api', 'graphql', '-f'])
    expect(calls[0]).toEqual(expect.arrayContaining(['o=example-org', 'n=example-repo', 'p=5']))
    expect(calls[0]!.some((arg) => arg.startsWith('c='))).toBe(false)
  })

  it('follows pages by cursor and marks a pull request with more than five as truncated', async () => {
    const loop = await makeLoop()
    const calls: string[][] = []
    const six = Array.from({ length: 6 }, () => [false])
    const pulls = {
      [REF]: { threads: [[false], [true], [false]] },
      'example-org/example-repo#6': { threads: six },
    }
    const result = await loop.cli(
      ['state', 'late-review', REF, 'example-org/example-repo#6'],
      gh(pulls, calls),
    )
    expect(result.stdout).toBe(
      `${REF} MERGED mergedAt=${MERGED_AT} unresolved=2 late=0\n` +
        `example-org/example-repo#6 MERGED mergedAt=${MERGED_AT} unresolved=5 late=0 truncated\n`,
    )
    expect(calls[1]).toEqual(expect.arrayContaining(['-f', 'c=1']))
  })

  it('prints an open pull request with mergedAt=None and no late reviews', async () => {
    const loop = await makeLoop()
    const reviews = [[{ body: 'note', submittedAt: '2026-02-01T00:00:00Z' }]]
    const run = gh({ [REF]: { state: 'OPEN', mergedAt: null, reviews } })
    expect((await loop.cli(['state', 'late-review', REF], run)).stdout).toBe(
      `${REF} OPEN mergedAt=None unresolved=0 late=0\n`,
    )
  })

  it('reports each failed reference on stdout, exits 1, and still checks the rest', async () => {
    const loop = await makeLoop()
    const run: RunProcess = async (_command, args) => {
      if (args.includes('n=denied')) return done('', 1, ` HTTP 403 ${'x'.repeat(300)}\n`)
      if (args.includes('n=gone')) return done('{"data":{"repository":null}}')
      if (args.includes('n=odd')) {
        return done('{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":null}}}}}')
      }
      return graphqlReply(args, {})
    }
    const refs = [
      'not-a-ref',
      'example-org/denied#1',
      'example-org/gone#2',
      'example-org/odd#3',
      REF,
    ]
    const result = await loop.cli(['state', 'late-review', ...refs], run)
    const lines = result.stdout.split('\n')
    expect(result.code).toBe(1)
    expect(lines[0]).toBe("not-a-ref error: 'not-a-ref' must look like owner/repo#N")
    expect(lines[1]).toBe(`example-org/denied#1 error: gh exited 1: HTTP 403 ${'x'.repeat(191)}`)
    expect(lines[2]).toBe('example-org/gone#2 error: pull request not found or unexpected response')
    expect(lines[3]).toBe('example-org/odd#3 error: pull request not found or unexpected response')
    expect(lines[4]).toBe(`${REF} MERGED mergedAt=${MERGED_AT} unresolved=0 late=0`)
  })

  it('needs a reference, and fails outright when gh cannot be started', async () => {
    const loop = await makeLoop()
    expect((await loop.cli(['state', 'late-review'])).code).toBe(2)
    const missing: RunProcess = async () => {
      throw new Error('spawn gh ENOENT')
    }
    expect(await loop.cli(['state', 'late-review', REF], missing)).toEqual({
      code: 1,
      stdout: '',
      stderr: 'spawn gh ENOENT\n',
    })
  })
})

describe('supervisor state watch', () => {
  afterEach(cleanupLoops)

  const merged =
    (answers: Record<string, string>, calls: string[][] = []): RunProcess =>
    async (command, args) => {
      calls.push([command, ...args])
      return done(answers[args[1]!] ?? '')
    }

  it('adds a watch that records which pull requests have already merged', async () => {
    const loop = await makeLoop()
    const calls: string[][] = []
    const run = merged({ 'repos/Example-Org/example-repo/pulls/5': `${MERGED_AT}\n` }, calls)
    const prs = ['--pr', 'Example-Org/example-repo#5', '--pr', 'example-user/other#6']
    const added = await loop.cli(
      ['state', 'watch', 'add', '--id', 'w1', '--notify', 's1', ...prs],
      run,
    )
    expect(JSON.parse(added.stdout)).toEqual([
      {
        id: 'w1',
        prs: ['Example-Org/example-repo#5', 'example-user/other#6'],
        notify: 's1',
        note: '',
        at: NOW,
        merged: ['example-org/example-repo#5'],
      },
    ])
    expect(calls[1]).toEqual([
      'gh',
      'api',
      'repos/example-user/other/pulls/6',
      '--jq',
      '.merged_at // empty',
    ])
    expect((await loop.cli(['state', 'watch', 'list'])).stdout).toBe(added.stdout)
  })

  it('refuses an incomplete, duplicate, or malformed watch, and a failed merge check', async () => {
    const loop = await makeLoop()
    const add = (...rest: string[]) => loop.cli(['state', 'watch', 'add', ...rest], merged({}))
    const needs = 'watch add needs --id, --notify, and at least one --pr\n'
    expect((await add('--id', 'w', '--notify', 's')).stderr).toBe(needs)
    expect((await add('--id', 'w', '--pr', 'o/r#1')).stderr).toBe(needs)
    expect((await add('--notify', 's', '--pr', 'o/r#1')).stderr).toBe(needs)
    expect((await add('--id', 'w', '--notify', 's', '--pr', 'o/r')).stderr).toBe(
      "watch add: 'o/r' must look like owner/repo#N\n",
    )
    await add('--id', 'w', '--notify', 's', '--pr', 'o/r#1', '--note', 'tell them')
    expect((await loop.state()).watches[0].note).toBe('tell them')
    expect((await add('--id', 'w', '--notify', 's', '--pr', 'o/r#2')).stderr).toBe(
      "watch add: 'w' already exists\n",
    )
    const denied: RunProcess = async () => done('', 4, 'no access')
    const failed = await loop.cli(
      ['state', 'watch', 'add', '--id', 'x', '--notify', 's', '--pr', 'o/r#3'],
      denied,
    )
    expect(failed).toMatchObject({ code: 1, stderr: 'watch add: gh exited 4: no access\n' })
    const broken: RunProcess = async () => {
      throw new Error('spawn gh ENOENT')
    }
    const crashed = await loop.cli(
      ['state', 'watch', 'add', '--id', 'x', '--notify', 's', '--pr', 'o/r#3'],
      broken,
    )
    expect(crashed.stderr).toBe('spawn gh ENOENT\n')
    expect((await loop.state()).watches).toHaveLength(1)
  })

  it('acknowledges and removes a watch by id', async () => {
    const loop = await makeLoop()
    await loop.seed({ watches: [{ id: 'w1', prs: [] }, { id: 'w2', prs: [] }, 'junk'] })
    expect((await loop.cli(['state', 'watch', 'ack', '--id', 'nope'])).stderr).toBe(
      "watch ack: no watch 'nope'\n",
    )
    await loop.cli(['state', 'watch', 'ack', '--id', 'w2'])
    expect((await loop.state()).watches[1]).toEqual({ id: 'w2', prs: [], ackedAt: NOW })
    const removed = await loop.cli(['state', 'watch', 'remove', '--id', 'w1'])
    expect(removed.stdout).toBe(`[{"id": "w2", "prs": [], "ackedAt": "${NOW}"}, "junk"]\n`)
    expect((await loop.cli(['state', 'watch'])).code).toBe(2)
    expect((await loop.cli(['state', 'watch', 'pause'])).code).toBe(2)
    expect((await loop.cli(['state', 'watch', 'list', 'extra'])).code).toBe(2)
  })
})
