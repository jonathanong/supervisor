import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { classifyGh, policy, PR, tempDir } from './helpers/classify.js'
import { check, file, fixture, HEAD, OLD_HEAD, policyDir, REVIEWER } from './helpers/pull.js'

const TRUSTED = 'bot:example-reviewer'
const EXAMPLE_CONFIG = fileURLToPath(new URL('../examples/config.example.json', import.meta.url))

function reviewBody(verdict: string, effort: string, findings = 'no findings'): string {
  return (
    `<!-- final-review sha=${HEAD} verdict=${verdict} effort=${effort} -->\n\n` +
    `## [${verdict.replace('-', ' ')}] Code review\n\n` +
    `Reviewed \`${HEAD.slice(0, 12)}\` at ${effort} effort · ${findings}\n`
  )
}

function ghReview(
  body: string | null,
  overrides: Partial<{ user: unknown; state: unknown; commit: string | null }> = {},
) {
  return { user: REVIEWER, state: 'APPROVED', commit: HEAD, body, ...overrides }
}

describe('classify-prepare and classify-collect for claude/code_review', () => {
  it('prepares without reading the diff, collects claude/code_review, and merges docs-light', async () => {
    const out = await tempDir()
    const prepGh = classifyGh({ diffCode: 1 })
    const prep = await policy(
      ['classify-prepare', ...PR, '--dir', policyDir('docs-light'), '--out', out],
      prepGh.run,
    )
    expect(prep.code).toBe(0)
    expect(prep.stderr).toBe('')
    expect(JSON.parse(prep.stdout)).toEqual({
      pull: { repository: PR[0], number: 7, head: HEAD },
      classifiers: [],
      codeReview: true,
    })
    expect(prepGh.calls.some((args) => args.includes('Accept: application/vnd.github.diff'))).toBe(
      false,
    )

    const collectGh = classifyGh({
      reviews: [
        ghReview(null),
        ghReview(reviewBody('Approve', 'low'), { user: { login: null, type: null } }),
        ghReview(reviewBody('Approve', 'low'), { state: null }),
        ghReview(reviewBody('Approve', 'low'), { commit: null }),
        ghReview(reviewBody('Approve', 'low')),
      ],
    })
    const collected = await policy(
      ['classify-collect', '--out', out, '--reviewer', TRUSTED],
      collectGh.run,
    )
    expect(collected.code).toBe(0)
    expect(collected.stderr).toBe('')
    const classifiersPath = join(out, 'classifiers.json')
    expect(JSON.parse(await readFile(classifiersPath, 'utf8'))).toEqual({
      pull: { repository: PR[0], number: 7, head: HEAD },
      'claude/code_review': {
        status: 'complete',
        value: 'pass',
        level: 'quick',
        severity: 'none',
      },
    })

    const checked = await check(fixture({ files: [file('docs/guide.md')], reviews: [] }), [
      '--dir',
      policyDir('docs-light'),
      '--json',
      '--classifiers',
      classifiersPath,
    ])
    expect(checked.code).toBe(0)
    expect(JSON.parse(checked.stdout).nextStep).toEqual({ action: 'merge' })
  })

  it('feeds depth and severity from the final review into sensitive-deep policy checks', async () => {
    const runSensitive = async (body: string) => {
      const out = await tempDir()
      await policy(
        ['classify-prepare', ...PR, '--dir', policyDir('sensitive-deep'), '--out', out],
        classifyGh().run,
      )
      await policy(
        ['classify-collect', '--out', out, '--reviewer', TRUSTED],
        classifyGh({ reviews: [ghReview(body)] }).run,
      )
      const gh = fixture({
        files: [file('src/auth/login.ts')],
        reviews: [],
        teams: { 'example-org/security': [{ login: 'sec-lead', type: 'User' }] },
      })
      const checked = await check(gh, [
        '--dir',
        policyDir('sensitive-deep'),
        '--json',
        '--classifiers',
        join(out, 'classifiers.json'),
      ])
      return JSON.parse(checked.stdout)
    }

    const shallow = await runSensitive(reviewBody('Approve', 'low'))
    expect(shallow.verdict).toBe('blocks')
    expect(shallow.nextStep).toEqual({ action: 'request_review', depth: 'deep' })

    const deepLow = await runSensitive(reviewBody('Approve', 'high', '1 finding (1 low)'))
    expect(deepLow.verdict).toBe('comments')
    expect(deepLow.seats[0].from).toContain('example-org/security')

    const deepMedium = await runSensitive(
      reviewBody('Approve', 'high', '2 findings (1 medium, 1 low)'),
    )
    expect(deepMedium.verdict).toBe('blocks')
  })

  it('falls back to finalReview.reviewer from config and fails closed when no reviewer is set', async () => {
    const out = await tempDir()
    await policy(
      ['classify-prepare', ...PR, '--dir', policyDir('docs-light'), '--out', out],
      classifyGh().run,
    )
    const fromConfig = await policy(
      ['classify-collect', '--out', out],
      classifyGh({ reviews: [ghReview(reviewBody('Approve', 'low'))] }).run,
      { SUPERVISOR_CONFIG: EXAMPLE_CONFIG },
    )
    expect(fromConfig.code).toBe(0)
    expect(fromConfig.stderr).toBe('')
    expect(
      JSON.parse(await readFile(join(out, 'classifiers.json'), 'utf8'))['claude/code_review'],
    ).toMatchObject({ status: 'complete', value: 'pass', level: 'quick' })

    const noReviewer = await policy(['classify-collect', '--out', out], classifyGh().run)
    expect(noReviewer.code).toBe(0)
    expect(noReviewer.stderr).toContain('no trusted reviewer configured')
    expect(JSON.parse(await readFile(join(out, 'classifiers.json'), 'utf8'))).toEqual({
      pull: { repository: PR[0], number: 7, head: HEAD },
    })

    const noMatch = await policy(
      ['classify-collect', '--out', out, '--reviewer', TRUSTED],
      classifyGh({ reviews: [] }).run,
    )
    expect(noMatch.code).toBe(0)
    expect(noMatch.stderr).toContain(
      `claude/code_review: no result: no final review from ${TRUSTED}`,
    )
  })

  it('voids results if the head moves while reading reviews and rejects --reviewer on prepare', async () => {
    const out = await tempDir()
    const badPrepare = await policy(
      [
        'classify-prepare',
        ...PR,
        '--dir',
        policyDir('docs-light'),
        '--out',
        out,
        '--reviewer',
        TRUSTED,
      ],
      classifyGh().run,
    )
    expect(badPrepare.code).toBe(2)
    expect(badPrepare.stderr).toContain('--reviewer is only valid with classify-collect.')

    await policy(
      ['classify-prepare', ...PR, '--dir', policyDir('docs-light'), '--out', out],
      classifyGh().run,
    )
    const moved = await policy(
      ['classify-collect', '--out', out, '--reviewer', TRUSTED],
      classifyGh({ heads: [HEAD, OLD_HEAD], reviews: [ghReview(reviewBody('Approve', 'low'))] })
        .run,
    )
    expect(moved.code).toBe(1)
    expect(moved.stderr).toContain(`moved from ${HEAD} to ${OLD_HEAD}`)
    await expect(readFile(join(out, 'classifiers.json'))).rejects.toThrow()
  })
})
