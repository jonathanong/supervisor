import { isObject } from '../state/json.js'
import type { RunProcess } from '../state/process.js'

/** A pull request's facts could not be collected whole, so nothing is evaluated. */
export class FactsError extends Error {}

/** `<owner>/<repo>`; a part that is `.` or `..` would change the API path. */
export const REPOSITORY = /^(?!\.{1,2}\/)[\w.-]+\/(?!\.{1,2}$)[\w.-]+$/
export const PULL_NUMBER = /^[1-9]\d{0,9}$/
/** A stalled `gh` must not hang the check; a paginated read of a large PR fits well inside this. */
const GH_TIMEOUT_MS = 120_000
const COMMIT_SHA = /^[0-9a-f]{40,64}$/

/**
 * One `gh api` GET from an argument array. The jq filter keeps only the named fields, so a
 * title, a body or a patch never enters this process; it prints one JSON value per line.
 */
export async function ghApi(
  run: RunProcess,
  endpoint: string,
  jq: string,
  paginate = false,
): Promise<unknown[]> {
  const args = ['api', ...(paginate ? ['--paginate'] : []), endpoint, '--jq', jq]
  const done = await run('gh', args, { timeoutMs: GH_TIMEOUT_MS })
  if (done.code !== 0) {
    const detail = done.stderr.trim().slice(0, 200)
    throw new FactsError(`gh api ${endpoint} exited ${done.code}: ${detail}`)
  }
  try {
    return done.stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as unknown)
  } catch {
    throw new FactsError(`gh api ${endpoint} printed something that is not JSON`)
  }
}

/** Like `ghApi`, for a filter that prints objects; anything else fails closed. */
export async function ghObjects(
  run: RunProcess,
  endpoint: string,
  jq: string,
  paginate = false,
): Promise<Array<Record<string, unknown>>> {
  const values = await ghApi(run, endpoint, jq, paginate)
  if (!values.every(isObject)) {
    throw new FactsError(`gh api ${endpoint} printed something that is not an object`)
  }
  return values
}

export function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new FactsError(`GitHub returned no ${what}`)
  }
  return value
}

export function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new FactsError(`GitHub returned no ${what}`)
  }
  return value
}

export function commitSha(value: unknown, what: string): string {
  const sha = text(value, what)
  if (!COMMIT_SHA.test(sha)) {
    throw new FactsError(`GitHub returned a ${what} that is not a commit SHA`)
  }
  return sha
}

/**
 * The name a policy uses for a GitHub account: the login, or `bot:<app slug>` for a GitHub App
 * (`dependabot[bot]` becomes `bot:dependabot`). A person whose login is `dependabot` stays
 * `dependabot`. Undefined when the API gave no account.
 */
export function accountName(value: unknown): string | undefined {
  if (!isObject(value) || typeof value.login !== 'string' || value.login === '') {
    return undefined
  }
  const isBot = value.type === 'Bot' || value.login.endsWith('[bot]')
  return isBot ? `bot:${value.login.replace(/\[bot\]$/, '')}` : value.login
}
