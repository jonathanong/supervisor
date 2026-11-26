import { FactsError } from './facts-gh.js'

/** The part of pr-shepherd's `status` answer that the policy reads. */
export interface ShepherdAnswer {
  /** What pr-shepherd would do next: `merge`, `wait`, `triage`, `escalate` and so on. */
  action: string
  /** The head pr-shepherd evaluated. Absent when GitHub did not report it. */
  headSha?: string
  /** pr-shepherd's one-line account of why it chose the action, when it gave one. */
  log?: string
}

/**
 * Asks pr-shepherd, read-only, about one pull request: `owner/repo#N`, with `cwd` a checkout
 * of that repository, where pr-shepherd reads its config. Tests replace it so nothing is read.
 */
export type ShepherdStatus = (pull: string, cwd: string) => Promise<ShepherdAnswer>

/**
 * Whether pr-shepherd would merge this head now. The supervisor reads no check and no merge
 * state itself: pr-shepherd decides, from the repository's required checks, reviews and rules.
 */
export interface Readiness {
  ready: boolean
  /** pr-shepherd's action for the head. */
  action: string
  /** Why pr-shepherd chose it, or why its answer cannot count as ready. */
  summary?: string
}

/** Ask pr-shepherd whether `head` can merge. A failed call is a failed read, never "ready". */
export async function collectReadiness(
  status: ShepherdStatus,
  repository: string,
  number: number,
  head: string,
  cwd: string,
): Promise<Readiness> {
  const pull = `${repository}#${number}`
  let answer: ShepherdAnswer
  try {
    answer = await status(pull, cwd)
  } catch (err) {
    throw new FactsError(`pr-shepherd could not read ${pull}: ${(err as Error).message}`, {
      cause: err,
    })
  }
  if (answer.headSha === undefined) {
    return { ready: false, action: answer.action, summary: 'pr-shepherd did not report its head' }
  }
  if (answer.headSha.toLowerCase() !== head) {
    throw new FactsError(`${pull} got a new head while pr-shepherd read it`)
  }
  return {
    ready: answer.action === 'merge',
    action: answer.action,
    ...(answer.log ? { summary: answer.log } : {}),
  }
}
