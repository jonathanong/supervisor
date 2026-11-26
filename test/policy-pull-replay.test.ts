import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/run.js'
import { ghApi } from '../src/policy/facts-gh.js'
import { runProcess, type ProcessOptions } from '../src/state/process.js'
import { check, file, fixture, policyDir } from './helpers/pull.js'
import { done } from './helpers/loop.js'

const DIR = ['--dir', policyDir('pull-facts')]
let temp: string
let classifiers: string

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'supervisor-pull-replay-'))
  classifiers = join(temp, 'classifiers.json')
  const review = { status: 'complete', value: 'pass', level: 'quick' }
  await writeFile(classifiers, JSON.stringify({ 'claude/code_review': review }))
})

afterAll(async () => {
  await rm(temp, { recursive: true, force: true })
})

/** Run `supervisor policy check --input <file>` on a written input. */
async function replay(name: string, input: unknown, extra: string[] = ['--json']) {
  const path = join(temp, name)
  await writeFile(path, JSON.stringify(input))
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(['policy', 'check', ...DIR, '--input', path, ...extra], {
    env: {},
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    startMcp: async () => undefined,
    runProcess: async () => {
      throw new Error('a replay reads nothing from GitHub')
    },
    shepherdStatus: async () => {
      throw new Error('a replay does not ask pr-shepherd')
    },
    now: () => new Date(0),
  })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

describe('policy check --input on a printed input', () => {
  const print = ['--print-input', '--classifiers']

  it('holds the merge that a draft or a pr-shepherd wait held live', async () => {
    const files = [file('docs/guide.md')]
    const draft = fixture({ files, reviews: [], pull: { draft: true } })
    const printed = JSON.parse((await check(draft, [...DIR, ...print, classifiers])).stdout)
    expect(printed.blockers).toEqual(['The pull request is a draft'])

    const replayed = await replay('draft.json', printed)
    expect(replayed.code).toBe(1)
    expect(JSON.parse(replayed.stdout).nextStep).toEqual({
      action: 'escalate',
      reason: 'The pull request is a draft',
    })
    expect(JSON.parse(replayed.stdout).policyNextStep).toEqual({ action: 'merge' })
    expect((await replay('draft.json', printed, [])).stdout).toContain('Blocker: ')

    const waiting = { ...printed, blockers: [], readiness: { ready: false, action: 'wait' } }
    const held = await replay('waiting.json', waiting)
    expect(held.code).toBe(1)
    expect(JSON.parse(held.stdout).nextStep.action).toBe('shepherd')
    const ready = { ...printed, blockers: [], readiness: { ready: true, action: 'merge' } }
    expect((await replay('ready.json', ready)).code).toBe(0)
  })

  it('refuses a printed input that lost its readiness or blockers', async () => {
    const open = fixture({ files: [file('docs/guide.md')], reviews: [] })
    const printed = JSON.parse((await check(open, [...DIR, ...print, classifiers])).stdout)
    for (const key of ['pull', 'readiness', 'blockers']) {
      const partial = { ...printed }
      delete partial[key]
      const result = await replay(`no-${key}.json`, partial)
      expect(result.code).toBe(2)
      expect(result.stderr).toBe('A printed input needs pull, readiness and blockers together\n')
    }
    // A string would count as true: only a boolean says whether pr-shepherd would merge.
    const text = { ...printed, readiness: { ready: 'false', action: 'wait' } }
    const result = await replay('text-ready.json', text)
    expect(result.code).toBe(2)
    expect(result.stderr).toBe('A printed input needs readiness.ready as true or false\n')
  })
})

describe('an input from before pr-shepherd', () => {
  it('is refused, with the way to print a new one', async () => {
    const open = fixture({ files: [file('docs/guide.md')], reviews: [] })
    const printed = JSON.parse((await check(open, [...DIR, '--print-input'])).stdout)
    const { readiness: _, ...rest } = printed
    const old = { ...rest, checks: { state: 'success', total: 1 } }
    const result = await replay('old.json', old)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('old checks key')
    expect(result.stderr).toContain('--print-input')
  })

  it('carries the readiness a printed input holds', async () => {
    const open = fixture({ files: [file('docs/guide.md')], reviews: [] })
    const printed = JSON.parse((await check(open, [...DIR, '--print-input'])).stdout)
    expect(printed.readiness).toEqual({ ready: true, action: 'merge' })
    expect('checks' in printed).toBe(false)
  })
})

describe('gh calls', () => {
  it('gives every gh call a timeout', async () => {
    const seen: Array<ProcessOptions | undefined> = []
    await ghApi(
      async (_command, _args, options) => {
        seen.push(options)
        return done('{}')
      },
      'repos/example-org/example-repo/pulls/7',
      '{}',
    )
    expect(seen).toEqual([{ timeoutMs: 120_000 }])
  })

  it('kills a child that outlives its timeout', async () => {
    const stalled = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 100,
    })
    expect(stalled.code).toBe(1)
  })
})
