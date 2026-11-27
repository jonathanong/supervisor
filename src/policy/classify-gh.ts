import { commitSha, FactsError, ghObjects } from './facts-gh.js'
import type { RunProcess } from '../state/process.js'

const GH_TIMEOUT_MS = 120_000

/** The pull request's current head commit. */
export async function readHead(
  run: RunProcess,
  repository: string,
  number: number,
): Promise<string> {
  const [pull] = await ghObjects(run, `repos/${repository}/pulls/${number}`, '{head: .head.sha}')
  return commitSha(pull?.head, 'head SHA')
}

/**
 * The pull request's whole diff. GitHub refuses a diff that is too large instead of cutting
 * it, and that refusal fails here: a partial diff is never returned.
 */
export async function readDiff(
  run: RunProcess,
  repository: string,
  number: number,
): Promise<string> {
  const endpoint = `repos/${repository}/pulls/${number}`
  const args = ['api', '-H', 'Accept: application/vnd.github.diff', endpoint]
  const done = await run('gh', args, { timeoutMs: GH_TIMEOUT_MS })
  if (done.code !== 0) {
    const detail = done.stderr.trim().slice(0, 200)
    throw new FactsError(
      `gh api ${endpoint} exited ${done.code}: ${detail}; the diff may be too large to read whole`,
    )
  }
  if (done.stdout.trim() === '') throw new FactsError(`GitHub returned no diff for ${endpoint}`)
  return done.stdout
}
