import type { RunProcess } from '../state/process.js'
import { FactsError, ghObjects, text } from './facts-gh.js'

/**
 * The checks on the head, as GitHub marks them for this pull request. The supervisor asks
 * GitHub which checks the pull request requires and keeps no list of its own. When GitHub marks
 * any as required, only those hold the merge. When it marks none, every check on the head must
 * pass. A required check that has not reported yet is not in GitHub's list, so the supervisor
 * also reads GitHub's merge state, and holds when it is BLOCKED.
 */
export interface CheckState {
  source: 'required-checks' | 'all-checks-on-head'
  /** `none` means the head has no check run and no status at all. */
  state: 'success' | 'pending' | 'failure' | 'none'
  /** Every check on the head, required or not. */
  total: number
  /** Failing checks that hold the merge. */
  failing: string[]
  /** Pending checks that hold the merge. */
  pending: string[]
  /** Failing or pending checks that GitHub does not require; they do not hold the merge. */
  notRequired: string[]
  /** GitHub's `mergeStateStatus` of the pull request, such as CLEAN, UNSTABLE or BLOCKED. */
  mergeState: string
}

const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      mergeStateStatus
      commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          __typename
          ... on CheckRun { name status conclusion isRequired(pullRequestNumber: $number) }
          ... on StatusContext { context state isRequired(pullRequestNumber: $number) }
        }
      } } } } }
    }
  }
}`
const COMMIT_JQ =
  '.data.repository.pullRequest | {mergeState: .mergeStateStatus} + ' +
  '(.commits.nodes[0].commit | {oid, more: .statusCheckRollup.contexts.pageInfo.hasNextPage, ' +
  'contexts: .statusCheckRollup.contexts.nodes})'
const PASSING_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
const MAX_CHECKS = 100

type Outcome = 'passing' | 'failing' | 'pending'
interface Check {
  name: string
  outcome: Outcome
  required: boolean
}

function toCheck(node: unknown): Check {
  const check = (typeof node === 'object' && node !== null ? node : {}) as Record<string, unknown>
  if (typeof check.isRequired !== 'boolean') {
    throw new FactsError('GitHub did not say whether a check is required')
  }
  const required = check.isRequired
  if (check.__typename === 'CheckRun') {
    const name = text(check.name, 'check run name')
    if (check.status !== 'COMPLETED') return { name, outcome: 'pending', required }
    const passed = PASSING_CONCLUSIONS.has(check.conclusion as string)
    return { name, outcome: passed ? 'passing' : 'failing', required }
  }
  if (check.__typename === 'StatusContext') {
    const name = text(check.context, 'status context')
    if (check.state === 'SUCCESS') return { name, outcome: 'passing', required }
    return { name, outcome: check.state === 'PENDING' ? 'pending' : 'failing', required }
  }
  throw new FactsError('GitHub returned a check that is neither a check run nor a status')
}

export async function collectChecks(
  run: RunProcess,
  repository: string,
  number: number,
  head: string,
): Promise<CheckState> {
  const [owner, name] = repository.split('/') as [string, string]
  const fields = ['-f', `query=${QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`]
  fields.push('-F', `number=${number}`)
  const [commit] = await ghObjects(run, 'graphql', COMMIT_JQ, false, fields)
  if (!commit) throw new FactsError('gh api graphql printed nothing')
  if (text(commit.oid, 'head of the pull request') !== head) {
    throw new FactsError(`${repository}#${number} got a new head while its checks were read`)
  }
  const mergeState = text(commit.mergeState, 'merge state')
  if (commit.more === true) {
    throw new FactsError(
      `${repository}#${number} has more than ${MAX_CHECKS} checks on the head: ` +
        'the list would be partial, so nothing is evaluated',
    )
  }
  if (commit.contexts !== null && !Array.isArray(commit.contexts)) {
    throw new FactsError('GitHub returned no check list')
  }
  const checks = (commit.contexts ?? []).map(toCheck)
  const anyRequired = checks.some((check) => check.required)
  const holding = anyRequired ? checks.filter((check) => check.required) : checks
  const named = (list: Check[], outcome: Outcome) =>
    list.filter((check) => check.outcome === outcome).map((check) => check.name)
  const failing = named(holding, 'failing')
  const pending = named(holding, 'pending')
  const notRequired = anyRequired
    ? checks.filter((check) => !check.required && check.outcome !== 'passing').map((c) => c.name)
    : []
  let state: CheckState['state'] = 'none'
  if (failing.length > 0) state = 'failure'
  else if (pending.length > 0) state = 'pending'
  else if (checks.length > 0) state = 'success'
  return {
    source: anyRequired ? 'required-checks' : 'all-checks-on-head',
    state,
    total: checks.length,
    failing,
    pending,
    notRequired,
    mergeState,
  }
}
