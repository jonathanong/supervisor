import { SEVERITY_RANK } from './people.js'
import type { ClassifierResult, ReviewDepth, SeverityLevel } from './types.js'

/** One pull request review as read from GitHub for final-review mapping. */
export interface PullReview {
  author: string
  state: string
  commit: string | null
  body: string
}

const CANDIDATE_RE = /<!-- final-review\s[^>]*-->/
const MARKER_RE = /<!-- final-review sha=([0-9a-f]{40,64}) verdict=([A-Za-z-]+) effort=([a-z]+) -->/
const SUMMARY_RE =
  /^Reviewed `([0-9a-f]{12})` at ([a-z]+) effort · (no findings|[1-9]\d* findings? \(([^)\n]+)\))$/m
const COUNT_RE = /^[1-9]\d* ([a-z]+)$/

const EFFORT_TO_LEVEL = new Map<string, ReviewDepth>([
  ['low', 'quick'],
  ['medium', 'standard'],
  ['high', 'deep'],
])

const VERDICT_TO_VALUE = new Map<string, 'pass' | 'fail'>([
  ['Approve', 'pass'],
  ['Comment', 'fail'],
  ['Request-Changes', 'fail'],
])

const FINDING_SEVERITY = new Map<string, SeverityLevel>([
  ['blocking', 'critical'],
  ['high', 'high'],
  ['medium', 'medium'],
  ['low', 'low'],
])

function parseSeverity(body: string, head: string, effort: string): SeverityLevel | undefined {
  const summary = SUMMARY_RE.exec(body)
  if (!summary || summary[1] !== head.slice(0, 12) || summary[2] !== effort) return undefined
  if (summary[3] === 'no findings') return 'none'
  let highest: SeverityLevel | undefined
  for (const part of summary[4]!.split(',')) {
    const match = COUNT_RE.exec(part.trim())
    const mapped = match ? FINDING_SEVERITY.get(match[1]!) : undefined
    if (!mapped) return undefined
    if (!highest || SEVERITY_RANK[mapped] > SEVERITY_RANK[highest]) highest = mapped
  }
  return highest
}

/**
 * Maps the newest final review of `head` by `reviewer` to a `claude/code_review` classifier result.
 * Returns a string reason when there is no usable result so the caller omits it and fails closed.
 */
export function mapFinalReview(
  reviews: readonly PullReview[],
  head: string,
  reviewer: string,
): ClassifierResult | string {
  const wanted = reviewer.toLowerCase()
  const latest = reviews
    .filter(
      (review) =>
        review.state !== 'PENDING' &&
        review.author.toLowerCase() === wanted &&
        CANDIDATE_RE.test(review.body),
    )
    .at(-1)
  if (!latest) return `no final review from ${reviewer}`
  if (latest.state === 'DISMISSED') {
    return `the latest final review from ${reviewer} was dismissed`
  }
  const marker = MARKER_RE.exec(latest.body)
  if (!marker) return `malformed final-review marker from ${reviewer}`
  const [, sha, verdict, effort] = marker
  if (sha !== head || latest.commit !== head) {
    return `the latest final review from ${reviewer} is for another head`
  }
  if (verdict === 'Skipped') {
    return `the latest final review from ${reviewer} was skipped`
  }
  const level = EFFORT_TO_LEVEL.get(effort!)
  if (!level) return `unknown review effort '${effort}'`
  const value = VERDICT_TO_VALUE.get(verdict!)
  if (!value) return `unknown review verdict '${verdict}'`
  const severity = parseSeverity(latest.body, head, effort!)
  return {
    status: 'complete',
    value,
    level,
    ...(severity ? { severity } : {}),
  }
}
