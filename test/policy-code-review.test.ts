import { describe, expect, it } from 'vitest'
import { mapFinalReview, type PullReview } from '../src/policy/code-review.js'
import { HEAD, OLD_HEAD } from './helpers/pull.js'

const TRUSTED = 'bot:example-reviewer'

function reviewBody(verdict: string, effort: string, findings = 'no findings', sha = HEAD): string {
  const marker = `<!-- final-review sha=${sha} verdict=${verdict} effort=${effort} -->`
  if (verdict === 'Skipped') return `**Code review skipped:** lockfile only\n\n${marker}`
  return (
    `${marker}\n\n## [${verdict.replace('-', ' ')}] Code review\n\n` +
    `Reviewed \`${sha.slice(0, 12)}\` at ${effort} effort · ${findings}\n`
  )
}

function pullReview(body: string, overrides: Partial<PullReview> = {}): PullReview {
  return { author: TRUSTED, state: 'APPROVED', commit: HEAD, body, ...overrides }
}

describe('mapFinalReview', () => {
  it('maps verdict, effort and finding severities for a trusted final review of the head', () => {
    expect(mapFinalReview([pullReview(reviewBody('Approve', 'low'))], HEAD, TRUSTED)).toEqual({
      status: 'complete',
      value: 'pass',
      level: 'quick',
      severity: 'none',
    })
    expect(
      mapFinalReview(
        [pullReview(reviewBody('Approve', 'medium', '1 finding (1 low)'))],
        HEAD,
        TRUSTED,
      ),
    ).toEqual({ status: 'complete', value: 'pass', level: 'standard', severity: 'low' })
    expect(
      mapFinalReview(
        [pullReview(reviewBody('Approve', 'high', '3 findings (2 medium, 1 low)'))],
        HEAD,
        TRUSTED,
      ),
    ).toEqual({ status: 'complete', value: 'pass', level: 'deep', severity: 'medium' })
    expect(
      mapFinalReview(
        [
          pullReview(reviewBody('Comment', 'medium', '2 findings (1 high, 1 low)'), {
            state: 'COMMENTED',
          }),
        ],
        HEAD,
        TRUSTED,
      ),
    ).toEqual({ status: 'complete', value: 'fail', level: 'standard', severity: 'high' })
    expect(
      mapFinalReview(
        [
          pullReview(reviewBody('Request-Changes', 'high', '2 findings (1 blocking, 1 medium)'), {
            state: 'CHANGES_REQUESTED',
          }),
        ],
        HEAD,
        TRUSTED,
      ),
    ).toEqual({ status: 'complete', value: 'fail', level: 'deep', severity: 'critical' })
    expect(
      mapFinalReview(
        [pullReview(reviewBody('Skipped', 'low'), { state: 'COMMENTED' })],
        HEAD,
        TRUSTED,
      ),
    ).toEqual({ status: 'complete', value: 'pass', level: 'quick', severity: 'none' })
  })

  it('matches the reviewer without case, accepts COMMENTED approvals, and takes the newest review', () => {
    const reviews = [
      pullReview(reviewBody('Request-Changes', 'high', '1 finding (1 blocking)'), {
        state: 'CHANGES_REQUESTED',
      }),
      pullReview(reviewBody('Approve', 'high'), {
        author: 'BOT:Example-Reviewer',
        state: 'COMMENTED',
      }),
    ]
    expect(mapFinalReview(reviews, HEAD, TRUSTED)).toEqual({
      status: 'complete',
      value: 'pass',
      level: 'deep',
      severity: 'none',
    })
  })

  it('ignores untrusted authors, pending drafts, and non-bot lookalikes', () => {
    const spoofed = [
      pullReview(reviewBody('Approve', 'high'), { author: 'example-reviewer' }),
      pullReview(reviewBody('Approve', 'high'), { author: 'pr-author' }),
      pullReview(reviewBody('Approve', 'high'), { state: 'PENDING' }),
      pullReview('Looks good to me!'),
    ]
    expect(mapFinalReview(spoofed, HEAD, TRUSTED)).toBe(`no final review from ${TRUSTED}`)
  })

  it('returns no result when the latest review is dismissed, stale, or has an unknown marker value', () => {
    const dismissed = [
      pullReview(reviewBody('Approve', 'high')),
      pullReview(reviewBody('Approve', 'high'), { state: 'DISMISSED' }),
    ]
    expect(mapFinalReview(dismissed, HEAD, TRUSTED)).toContain('was dismissed')
    expect(
      mapFinalReview(
        [pullReview(reviewBody('Approve', 'high', 'no findings', OLD_HEAD))],
        HEAD,
        TRUSTED,
      ),
    ).toContain('another head')
    expect(
      mapFinalReview(
        [pullReview(reviewBody('Approve', 'high'), { commit: OLD_HEAD })],
        HEAD,
        TRUSTED,
      ),
    ).toContain('another head')
    expect(
      mapFinalReview([pullReview(reviewBody('Approve', 'high'), { commit: null })], HEAD, TRUSTED),
    ).toContain('another head')
    expect(mapFinalReview([pullReview(reviewBody('Approve', 'extreme'))], HEAD, TRUSTED)).toContain(
      "unknown review effort 'extreme'",
    )
    expect(mapFinalReview([pullReview(reviewBody('Ship-It', 'high'))], HEAD, TRUSTED)).toContain(
      "unknown review verdict 'Ship-It'",
    )
  })

  it('omits severity when the summary line is absent, mismatched, or lists an unknown severity', () => {
    const cases = [
      `<!-- final-review sha=${HEAD} verdict=Approve effort=high -->\n`,
      `<!-- final-review sha=${HEAD} verdict=Approve effort=high -->\nReviewed \`${OLD_HEAD.slice(0, 12)}\` at high effort · no findings\n`,
      `<!-- final-review sha=${HEAD} verdict=Approve effort=high -->\nReviewed \`${HEAD.slice(0, 12)}\` at low effort · no findings\n`,
      reviewBody('Approve', 'high', '1 finding (1 nit)'),
      reviewBody('Approve', 'high', '1 finding (0 low)'),
    ]
    for (const body of cases) {
      expect(mapFinalReview([pullReview(body)], HEAD, TRUSTED)).toEqual({
        status: 'complete',
        value: 'pass',
        level: 'deep',
      })
    }
  })
})
