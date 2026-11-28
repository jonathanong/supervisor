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
  })

  it('matches the reviewer without case, ignores continuation parts, and takes the newest review', () => {
    const reviews = [
      pullReview(reviewBody('Request-Changes', 'high', '1 finding (1 blocking)'), {
        state: 'CHANGES_REQUESTED',
      }),
      pullReview(reviewBody('Approve', 'high'), {
        author: 'BOT:Example-Reviewer',
        state: 'COMMENTED',
      }),
      pullReview(`<!-- final-review-part sha=${HEAD} part=2 -->\nMore details`, {
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

  it('returns no result for skipped, dismissed, stale, malformed, or prototype-named markers', () => {
    expect(
      mapFinalReview(
        [pullReview(reviewBody('Skipped', 'low'), { state: 'COMMENTED' })],
        HEAD,
        TRUSTED,
      ),
    ).toContain('was skipped')
    expect(
      mapFinalReview(
        [
          pullReview(reviewBody('Approve', 'high')),
          pullReview(reviewBody('Approve', 'high'), { state: 'DISMISSED' }),
        ],
        HEAD,
        TRUSTED,
      ),
    ).toContain('was dismissed')
    expect(
      mapFinalReview(
        [
          pullReview(reviewBody('Approve', 'high')),
          pullReview(`<!-- final-review sha=${HEAD} verdict=Request-Changes effort=HIGH -->`, {
            state: 'CHANGES_REQUESTED',
          }),
        ],
        HEAD,
        TRUSTED,
      ),
    ).toContain('malformed final-review marker')
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
    expect(
      mapFinalReview([pullReview(reviewBody('Approve', 'constructor'))], HEAD, TRUSTED),
    ).toContain("unknown review effort 'constructor'")
    expect(mapFinalReview([pullReview(reviewBody('toString', 'high'))], HEAD, TRUSTED)).toContain(
      "unknown review verdict 'toString'",
    )
  })

  it('omits severity when the summary line is absent, mismatched, or lists an unknown severity', () => {
    const cases = [
      `<!-- final-review sha=${HEAD} verdict=Approve effort=high -->\n`,
      `<!-- final-review sha=${HEAD} verdict=Approve effort=high -->\nReviewed \`${OLD_HEAD.slice(0, 12)}\` at high effort · no findings\n`,
      `<!-- final-review sha=${HEAD} verdict=Approve effort=high -->\nReviewed \`${HEAD.slice(0, 12)}\` at low effort · no findings\n`,
      reviewBody('Approve', 'high', '1 finding (1 nit)'),
      reviewBody('Approve', 'high', '1 finding (1 constructor)'),
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
