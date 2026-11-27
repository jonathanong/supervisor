import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyGh, policy, PR, tempDir, writeTree } from './helpers/classify.js'
import { check, fixture, HEAD, OLD_HEAD, policyDir } from './helpers/pull.js'

const DIR = policyDir('classify-flake-fix')
const BOUND = { repository: PR[0], number: 7, head: HEAD }

/** Prepare one pull request and write each answer; `answers` is by classifier name. */
async function prepared(answers: Record<string, string>) {
  const out = await tempDir()
  await policy(['classify-prepare', ...PR, '--dir', DIR, '--out', out], classifyGh().run)
  for (const [name, text] of Object.entries(answers)) {
    await writeFile(join(out, `${name}.answer.json`), text)
  }
  return out
}

const collect = (out: string, heads = [HEAD]) =>
  policy(['classify-collect', '--out', out], classifyGh({ heads }).run)

describe('supervisor policy classify-collect', () => {
  it('writes a valid answer in the shape policy check reads', async () => {
    const out = await prepared({ flake_fix: '{"answer": "yes"}' })
    const result = await collect(out)
    expect(result).toEqual({ code: 0, stdout: `${join(out, 'classifiers.json')}\n`, stderr: '' })
    expect(JSON.parse(await readFile(join(out, 'classifiers.json'), 'utf8'))).toEqual({
      pull: BOUND,
      'repo/flake_fix': { status: 'complete', value: 'yes', outputs: { answer: 'yes' } },
    })
  })

  it('leaves out an answer that is not allowed, with the reason on stderr', async () => {
    const cases: Array<[string | undefined, string]> = [
      ['{"answer": "maybe"}', 'missing or not an allowed value'],
      ['{"answer": 1}', 'missing or not an allowed value'],
      ['{}', "output 'answer' is missing"],
      ['{"answer": "yes", "extra": "no"}', "names 'extra'"],
      ['I think yes', 'not JSON'],
      ['["yes"]', 'not a JSON object'],
      [undefined, 'there is no answer file'],
    ]
    for (const [text, reason] of cases) {
      const out = await prepared(text === undefined ? {} : { flake_fix: text })
      const result = await collect(out)
      expect(result.code).toBe(0)
      expect(result.stderr).toMatch(/^repo\/flake_fix: no result: /)
      expect(result.stderr).toContain(reason)
      expect(JSON.parse(await readFile(join(out, 'classifiers.json'), 'utf8'))).toEqual({
        pull: BOUND,
      })
    }
  })

  it('keeps every output of a multi-output classifier, and checks a numeric range', async () => {
    const dir = await tempDir()
    await writeTree(dir, {
      '.claude/approvals.yml': `version: 1
rules:
  - purpose: p
    paths: ['**']
    verdict: { claude: comments, seats: 1 }
    override:
      - { if: 'repo/risk.level = low', verdict: { claude: approves, seats: 0 } }
`,
      '.claude/classifiers/risk/def.yml': `version: 1
description: How risky is this?
model: m
prompt: P
outputs:
  level: { type: ordinal, values: [low, high] }
  score: { type: numeric, min: 1, max: 3 }
`,
    })
    const out = await tempDir()
    await policy(['classify-prepare', ...PR, '--dir', dir, '--out', out], classifyGh().run)
    const answer = join(out, 'risk.answer.json')
    await writeFile(answer, '{"level": "low", "score": 4}')
    expect((await collect(out)).stderr).toContain('no result')
    await writeFile(answer, '{"level": "low", "score": 1.5}')
    expect((await collect(out)).stderr).toContain('no result')
    await writeFile(answer, '{"level": "low", "score": 3}')
    expect((await collect(out)).stderr).toBe('')
    expect(JSON.parse(await readFile(join(out, 'classifiers.json'), 'utf8'))).toEqual({
      pull: BOUND,
      'repo/risk': { status: 'complete', outputs: { level: 'low', score: 3 } },
    })
  })

  it('leaves out a classifier prepare listed with an error', async () => {
    const out = await tempDir()
    const manifest = {
      pull: { repository: PR[0], number: 7, head: HEAD },
      classifiers: [{ name: 'x', error: 'broken' }],
    }
    await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest))
    const result = await collect(out)
    expect(result.stderr).toBe('repo/x: no result: broken\n')
    expect(result.code).toBe(0)
  })

  it('refuses, and writes nothing, when the head moved since prepare', async () => {
    const out = await prepared({ flake_fix: '{"answer": "yes"}' })
    const result = await collect(out, [OLD_HEAD])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`moved from ${HEAD} to ${OLD_HEAD}`)
    await expect(readFile(join(out, 'classifiers.json'))).rejects.toThrow()
  })

  it('reports a missing or invalid manifest, and usage errors', async () => {
    const out = await tempDir()
    expect((await collect(out)).code).toBe(2)
    await writeFile(join(out, 'manifest.json'), '[]')
    expect((await collect(out)).stderr).toContain('not a classify-prepare manifest')
    for (const args of [
      ['classify-collect'],
      ['classify-collect', '--out', out, 'extra'],
      ['classify-collect', '--out', out, '--dir', out],
      ['classify-collect', '--out', out, '--supervisor-policy'],
    ]) {
      const result = await policy(args, classifyGh().run)
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('Usage:')
    }
  })
})

describe('a collected result in policy check', () => {
  const run = async (classifiers?: string) =>
    JSON.parse(
      (
        await check(fixture(), [
          '--dir',
          DIR,
          '--json',
          ...(classifiers ? ['--classifiers', classifiers] : []),
        ])
      ).stdout,
    )

  it('gives the outcome of the same result written by hand', async () => {
    const out = await prepared({ flake_fix: '{"answer": "yes"}' })
    await collect(out)
    const byHand = join(out, 'by-hand.json')
    await writeFile(byHand, '{"repo/flake_fix": {"status": "complete", "value": "yes"}}')
    const collected = await run(join(out, 'classifiers.json'))
    const written = await run(byHand)
    expect(collected.nextStep).toEqual({ action: 'merge' })
    expect({ ...collected, classifiers: null }).toEqual({ ...written, classifiers: null })
  })

  it('refuses results collected for another head, pull request or repository', async () => {
    const result = { 'repo/flake_fix': { status: 'complete', value: 'yes' } }
    for (const pull of [
      { ...BOUND, head: OLD_HEAD },
      { ...BOUND, number: 8 },
      { ...BOUND, repository: 'example/other' },
    ]) {
      const path = join(await tempDir(), 'classifiers.json')
      await writeFile(path, JSON.stringify({ pull, ...result }))
      const checked = await check(fixture(), ['--dir', DIR, '--json', '--classifiers', path])
      expect(checked.code).toBe(2)
      expect(checked.stderr).toContain('run the classifiers again')
    }
  })

  it('holds the stricter verdict for an answer that is not allowed, as for no result', async () => {
    const out = await prepared({ flake_fix: '{"answer": "maybe"}' })
    await collect(out)
    const collected = await run(join(out, 'classifiers.json'))
    expect(collected.classifiers).toEqual({})
    expect(collected).toEqual(await run())
    expect(collected.nextStep.action).not.toBe('merge')
  })
})
