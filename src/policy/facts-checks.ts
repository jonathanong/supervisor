import type { RunProcess } from '../state/process.js'
import { ghObjects, text } from './facts-gh.js'

/**
 * The state of every check run and commit status on the head. Which checks the base branch
 * requires is not read (branch protection is often unreadable), so this is stricter than
 * GitHub's own rule: one failing or pending check that is not required still holds the merge.
 */
export interface CheckState {
  source: 'all-checks-on-head'
  /** `none` means the head has no check run and no status at all. */
  state: 'success' | 'pending' | 'failure' | 'none'
  total: number
  failing: string[]
  pending: string[]
}

const RUNS_JQ = '.check_runs[] | {name, status, conclusion}'
const STATUSES_JQ = '.statuses[] | {name: .context, state}'
const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])

export async function collectChecks(
  run: RunProcess,
  repository: string,
  head: string,
): Promise<CheckState> {
  const commit = `repos/${repository}/commits/${head}`
  const runs = await ghObjects(run, `${commit}/check-runs?per_page=100`, RUNS_JQ, true)
  const statuses = await ghObjects(run, `${commit}/status?per_page=100`, STATUSES_JQ, true)
  const failing: string[] = []
  const pending: string[] = []
  for (const check of runs) {
    const name = text(check.name, 'check run name')
    if (check.status !== 'completed') pending.push(name)
    else if (!PASSING_CONCLUSIONS.has(check.conclusion as string)) failing.push(name)
  }
  for (const status of statuses) {
    const name = text(status.name, 'status context')
    if (status.state === 'pending') pending.push(name)
    else if (status.state !== 'success') failing.push(name)
  }
  const total = runs.length + statuses.length
  const state =
    failing.length > 0 ? 'failure' : pending.length > 0 ? 'pending' : total > 0 ? 'success' : 'none'
  return { source: 'all-checks-on-head', state, total, failing, pending }
}
