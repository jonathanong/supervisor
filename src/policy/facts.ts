import type { RunProcess } from '../state/process.js'
import { collectChecks, type CheckState } from './facts-checks.js'
import { accountName, commitSha, count, FactsError, ghObjects, text } from './facts-gh.js'
import { collectTeams } from './facts-teams.js'
import type { ClassifierResult, EvaluationFacts, EvaluationInput } from './types.js'

/** The files endpoint lists at most this many files, and says nothing when it stops. */
const MAX_FILES = 3000

const PULL_JQ =
  '{head: .head.sha, base: .base.ref, user: (.user | {login, type}), ' +
  'labels: [.labels[].name], additions, deletions, files: .changed_files, commits, state, draft}'
const FILES_JQ = '.[] | {filename, previous: .previous_filename, status}'
const COMMITS_JQ = '.[] | {sha, author: (.author | {login, type})}'
const REVIEWS_JQ = '.[] | {user: (.user | {login, type}), state, commit: .commit_id}'
/** A `COMMENTED` or `PENDING` review leaves a reviewer's earlier decision standing. */
const DECIDING_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'])

/**
 * A pull request's facts as `supervisor policy check --input` reads them, plus what the policy
 * does not judge: the head they describe, its checks, and reasons this head cannot merge.
 */
export interface PullFacts extends EvaluationInput {
  pull: { repository: string; number: number; head: string }
  checks: CheckState
  blockers: string[]
}

export interface CollectOptions {
  /** Each `<org>/<team>` the policy names. */
  teams: string[]
  classifiers?: Record<string, ClassifierResult>
}

function changedFiles(files: Array<Record<string, unknown>>): string[] {
  const names = new Set<string>()
  for (const file of files) {
    names.add(text(file.filename, 'file name'))
    if (file.previous !== null) names.add(text(file.previous, 'previous file name'))
  }
  return [...names]
}

/** Each reviewer whose latest decision is an approval of this head. */
function approvers(reviews: Array<Record<string, unknown>>, head: string): string[] {
  const latest = new Map<string, boolean>()
  for (const review of reviews) {
    const reviewer = accountName(review.user)
    if (reviewer === undefined || !DECIDING_STATES.has(review.state as string)) continue
    latest.set(reviewer, review.state === 'APPROVED' && review.commit === head)
  }
  return [...latest].filter(([, approved]) => approved).map(([reviewer]) => reviewer)
}

export async function collectPullFacts(
  run: RunProcess,
  repository: string,
  number: number,
  options: CollectOptions,
): Promise<PullFacts> {
  const endpoint = `repos/${repository}/pulls/${number}`
  const [pull] = await ghObjects(run, endpoint, PULL_JQ)
  if (!pull) throw new FactsError(`gh api ${endpoint} printed nothing`)
  const head = commitSha(pull.head, 'head SHA')
  const openedBy = accountName(pull.user)
  if (openedBy === undefined) throw new FactsError('GitHub returned no pull request author')
  const labels = pull.labels
  if (!Array.isArray(labels) || !labels.every((label) => typeof label === 'string')) {
    throw new FactsError('GitHub returned no label list')
  }
  const blockers: string[] = []
  if (pull.state !== 'open') blockers.push('The pull request is not open')
  if (pull.draft !== false) blockers.push('The pull request is a draft')

  const fileCount = count(pull.files, 'file count')
  if (fileCount >= MAX_FILES) {
    throw new FactsError(
      `${repository}#${number} changes ${fileCount} files and the API lists at most ` +
        `${MAX_FILES}: the list would be partial, so nothing is evaluated`,
    )
  }
  const files = await ghObjects(run, `${endpoint}/files?per_page=100`, FILES_JQ, true)
  if (files.length !== fileCount) {
    throw new FactsError(`GitHub listed ${files.length} of ${fileCount} changed files`)
  }
  const commitCount = count(pull.commits, 'commit count')
  const commits = await ghObjects(run, `${endpoint}/commits?per_page=100`, COMMITS_JQ, true)
  if (commits.length !== commitCount) {
    throw new FactsError(`GitHub listed ${commits.length} of ${commitCount} commits`)
  }
  const authors = new Set([openedBy])
  let everyAuthorKnown = true
  for (const commit of commits) {
    const author = accountName(commit.author)
    if (author !== undefined) {
      authors.add(author)
      continue
    }
    everyAuthorKnown = false
    const sha = commitSha(commit.sha, 'commit SHA').slice(0, 12)
    blockers.push(`Commit ${sha} has an author with no GitHub login`)
  }
  const reviews = await ghObjects(run, `${endpoint}/reviews?per_page=100`, REVIEWS_JQ, true)

  const facts: EvaluationFacts = {
    filesChanged: files.length,
    filesAdded: files.filter((file) => file.status === 'added').length,
    filesRemoved: files.filter((file) => file.status === 'removed').length,
    diffLines: count(pull.additions, 'addition count') + count(pull.deletions, 'deletion count'),
    openedBy,
    // With an author unknown the list is left out: the evaluator then cannot decide a
    // condition on `pr/authors`, instead of deciding it on a partial list.
    ...(everyAuthorKnown ? { authors: [...authors] } : {}),
    approvedBy: approvers(reviews, head),
    base: text(pull.base, 'base branch'),
    repository,
    labels: labels as string[],
  }
  if (options.teams.length > 0) facts.teams = await collectTeams(run, options.teams)
  const checks = await collectChecks(run, repository, number, head)
  if (checks.mergeState === 'BLOCKED') {
    blockers.push(
      'GitHub blocks the merge: a required check has not reported, or a branch rule is not met',
    )
  }

  const [after] = await ghObjects(run, endpoint, '{head: .head.sha}')
  if (after?.head !== head) {
    throw new FactsError(`${repository}#${number} got a new head while its facts were read`)
  }
  return {
    changedFiles: changedFiles(files),
    facts,
    ...(options.classifiers ? { classifiers: options.classifiers } : {}),
    pull: { repository, number, head },
    checks,
    blockers,
  }
}
