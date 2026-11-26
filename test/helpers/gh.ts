import type { ProcessResult } from '../../src/state/process.js'
import { done } from './loop.js'

export interface PullFixture {
  state?: string
  mergedAt?: string | null
  /** One entry per page of review threads; each page lists `isResolved` values. */
  threads?: boolean[][]
  /** One entry per page of reviews. */
  reviews?: Array<Array<{ body: string | null; submittedAt: string | null }>>
}

export const MERGED_AT = '2026-01-01T00:00:00Z'

/** Answer one `gh api graphql` late-review call from a fixture, following its page cursor. */
export function graphqlReply(args: string[], pull: PullFixture): ProcessResult {
  const query = args.find((arg) => arg.startsWith('query='))!
  const connection = query.includes('reviewThreads(') ? 'reviewThreads' : 'reviews'
  const pages: unknown[][] =
    connection === 'reviewThreads'
      ? (pull.threads ?? [[]]).map((page) => page.map((isResolved) => ({ isResolved })))
      : (pull.reviews ?? [[]])
  const cursor = args.find((arg) => arg.startsWith('c='))
  const index = cursor ? Number(cursor.slice(2)) : 0
  const hasNextPage = index + 1 < pages.length
  const pullRequest = {
    state: pull.state ?? 'MERGED',
    mergedAt: pull.mergedAt === undefined ? MERGED_AT : pull.mergedAt,
    [connection]: {
      pageInfo: { hasNextPage, endCursor: hasNextPage ? String(index + 1) : null },
      nodes: pages[index],
    },
  }
  return done(JSON.stringify({ data: { repository: { pullRequest } } }))
}
