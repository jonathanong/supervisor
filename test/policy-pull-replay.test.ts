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
    now: () => new Date(0),
  })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

describe('policy check --input on a printed input', () => {
  const print = ['--print-input', '--classifiers']

  it('holds the merge that a draft or a failing check held live', async () => {
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

    const failing = { ...printed, blockers: [], checks: { ...printed.checks, state: 'failure' } }
    expect((await replay('failing.json', failing)).code).toBe(1)
    const passing = { ...printed, blockers: [], checks: { ...printed.checks, state: 'success' } }
    expect((await replay('passing.json', passing)).code).toBe(0)
  })

  it('refuses a printed input that lost its checks or blockers', async () => {
    const open = fixture({ files: [file('docs/guide.md')], reviews: [] })
    const printed = JSON.parse((await check(open, [...DIR, ...print, classifiers])).stdout)
    for (const key of ['pull', 'checks', 'blockers']) {
      const partial = { ...printed }
      delete partial[key]
      const result = await replay(`no-${key}.json`, partial)
      expect(result.code).toBe(2)
      expect(result.stderr).toBe('A printed input needs pull, checks and blockers together\n')
    }
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
