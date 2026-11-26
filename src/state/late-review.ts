import type { RunProcess } from './process.js'

/** Threads and reviews are paged 100 at a time; a pull request with more pages is `truncated`. */
const MAX_PAGES = 5

export const PULL_REF = /^([\w.-]+)\/([\w.-]+)#(\d+)$/

const CONNECTIONS = { reviewThreads: 'isResolved', reviews: 'body submittedAt' } as const
type Connection = keyof typeof CONNECTIONS

interface Page {
  pull: { state: string; mergedAt: string | null }
  nodes: Array<{ isResolved?: boolean; body?: string | null; submittedAt?: string | null }>
  next: string | undefined
}

export interface LateReview {
  ref: string
  state: string
  mergedAt: string | null
  unresolved: number
  late: number
  truncated: boolean
}

export class LateReviewError extends Error {}

function parseRef(ref: string): [owner: string, name: string, number: string] {
  const match = PULL_REF.exec(ref)
  if (!match) {
    throw new LateReviewError(`'${ref}' must look like owner/repo#N`)
  }
  return [match[1]!, match[2]!, match[3]!]
}

async function gh(run: RunProcess, args: string[]): Promise<string> {
  const done = await run('gh', args)
  if (done.code !== 0) {
    throw new LateReviewError(`gh exited ${done.code}: ${done.stderr.trim().slice(0, 200)}`)
  }
  return done.stdout
}

async function page(
  run: RunProcess,
  [owner, name, number]: string[],
  connection: Connection,
  cursor: string | undefined,
): Promise<Page> {
  const query =
    'query($o:String!,$n:String!,$p:Int!,$c:String){repository(owner:$o,name:$n){pullRequest(number:$p){' +
    `state mergedAt ${connection}(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{${CONNECTIONS[connection]}}}}}}`
  const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `o=${owner}`, '-f', `n=${name}`]
  args.push('-F', `p=${number}`, ...(cursor ? ['-f', `c=${cursor}`] : []))
  const stdout = await gh(run, args)
  try {
    const pull = JSON.parse(stdout).data.repository.pullRequest
    const { nodes, pageInfo } = pull[connection]
    if (!Array.isArray(nodes)) {
      throw new TypeError('nodes')
    }
    return { pull, nodes, next: pageInfo.hasNextPage ? pageInfo.endCursor : undefined }
  } catch {
    throw new LateReviewError('pull request not found or unexpected response')
  }
}

async function fetchAll(run: RunProcess, target: string[], connection: Connection) {
  const nodes: Page['nodes'] = []
  let cursor: string | undefined
  for (let pages = 1; ; pages += 1) {
    const result = await page(run, target, connection, cursor)
    nodes.push(...result.nodes)
    cursor = result.next
    if (cursor === undefined || pages === MAX_PAGES) {
      return { pull: result.pull, nodes, truncated: cursor !== undefined }
    }
  }
}

/** The state of one `owner/repo#N`: unresolved threads and non-empty reviews after the merge. */
export async function checkLateReview(run: RunProcess, ref: string): Promise<LateReview> {
  const target = parseRef(ref)
  const threads = await fetchAll(run, target, 'reviewThreads')
  const reviews = await fetchAll(run, target, 'reviews')
  const mergedAt = threads.pull.mergedAt
  const late = reviews.nodes.filter(
    (review) =>
      mergedAt && (review.body ?? '').trim() && review.submittedAt && review.submittedAt > mergedAt,
  )
  return {
    ref,
    state: threads.pull.state,
    mergedAt,
    unresolved: threads.nodes.filter((thread) => !thread.isResolved).length,
    late: late.length,
    truncated: threads.truncated || reviews.truncated,
  }
}

export async function isMerged(run: RunProcess, ref: string): Promise<boolean> {
  const [owner, name, number] = parseRef(ref)
  const path = `repos/${owner}/${name}/pulls/${number}`
  return (await gh(run, ['api', path, '--jq', '.merged_at // empty'])).trim() !== ''
}

/** One report line; a pull request that never merged prints `mergedAt=None`. */
export function lateReviewLine(result: LateReview): string {
  const text =
    `${result.ref} ${result.state} mergedAt=${result.mergedAt ?? 'None'} ` +
    `unresolved=${result.unresolved} late=${result.late}`
  return text + (result.truncated ? ' truncated' : '')
}
