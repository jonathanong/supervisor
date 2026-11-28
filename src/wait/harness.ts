import {
  BadRequestError,
  NotLoggedInError,
  OutOfScopeError,
  pollEvents,
  resolveClient,
  UnauthorizedError,
  type EventFilter,
} from 'hook-harness/client'
import {
  ownersOf,
  parseRepoList,
  REPO_LIST_JQ,
  repoListEndpoint,
  scopesForOwner,
  selectRepos,
} from '../config/repos.js'
import { get, isObject, type Json, type JsonObject } from '../state/json.js'
import { loadState } from '../state/store.js'
import { WaitError, type WaitContext } from './context.js'

const ON_PRESETS = ['ejection', 'dependabot-pr', '/shepherd', '/plan', '/fix']
const FILTERS: EventFilter[] = [
  { event: 'workflow_run', action: 'completed', conclusion: 'failure', branch: 'main' },
  { event: 'pull_request', action: 'closed' },
]
const SINCE_MS = 10 * 60 * 1000
const POLL_INTERVAL_MS = 15_000
const MAX_CONSECUTIVE_ERRORS = 5
const MAX_TIMEOUT_MS = 2_147_483_647

export type HarnessResult =
  | (JsonObject & { events: Json[]; gap: boolean; cursor: string; timedOut?: undefined })
  | (JsonObject & { events: Json[]; gap: false; timedOut: true; cursor?: string })

async function gh(ctx: WaitContext, args: string[], what: string): Promise<string> {
  const result = await ctx.run('gh', args)
  if (result.code !== 0) {
    throw new WaitError(`${what} exited ${result.code}: ${result.stderr.trim().slice(0, 200)}`)
  }
  return result.stdout
}

/**
 * `<owner>/<name>` for every live repository the scopes select, owner by owner. A user scope first
 * asks who is signed in: only that user's own listing includes private repositories. A wait that
 * cannot tell fails, rather than quietly watching the public repositories alone. An owner whose
 * scopes select no repository is skipped with a warning, so one misconfigured owner does not stop
 * the wait for the others; the wait fails only when no owner has any.
 */
export async function listRepositories(ctx: WaitContext): Promise<string[]> {
  const all: string[] = []
  let login: string | undefined
  for (const owner of ownersOf(ctx.loaded)) {
    const scopes = scopesForOwner(ctx.loaded, owner)
    const scope = scopes[0]!
    if (scope.kind === 'user') {
      login ??= (await gh(ctx, ['api', 'user', '--jq', '.login'], 'gh api user')).trim()
    }
    const args = [
      'api',
      '--paginate',
      repoListEndpoint(scope, scope.kind === 'user' ? login : undefined),
      '--jq',
      REPO_LIST_JQ,
    ]
    const names = selectRepos(scopes, parseRepoList(await gh(ctx, args, 'gh')))
    if (names.length === 0) {
      ctx.write(`supervisor wait: skipping ${owner}: no repositories match its configuration\n`)
      continue
    }
    all.push(...names.map((name) => `${owner}/${name}`))
  }
  if (all.length === 0) {
    throw new WaitError('no repositories match the configuration')
  }
  return all
}

/** The owners of `<owner>/<name>` repositories, in order of first appearance. */
function ownersIn(repos: string[]): string[] {
  return [...new Set(repos.map((repo) => repo.slice(0, repo.indexOf('/'))))]
}

/**
 * `configuration` is true until the stream has yielded its first batch. hook-harness checks an
 * unknown preset, a non-https URL, or a missing owner with a `TypeError` before any fetch; after
 * that, `pollPages` reports fetch failures as `{error}` batches. A later `TypeError` is a bug in
 * this code or the client, not a configuration problem, so it takes the generic mapping.
 */
function mapHarnessError(error: unknown, configuration: boolean): WaitError {
  if (error instanceof WaitError) {
    return error
  }
  if (error instanceof NotLoggedInError || (configuration && error instanceof TypeError)) {
    return new WaitError(`hook-harness configuration error: ${error.message}`, { cause: error })
  }
  if (error instanceof UnauthorizedError) {
    return new WaitError(`hook-harness token rejected: ${error.message}`, { cause: error })
  }
  if (error instanceof OutOfScopeError) {
    return new WaitError(`hook-harness token out of scope: ${error.message}`, { cause: error })
  }
  if (error instanceof BadRequestError) {
    return new WaitError(`hook-harness bad request: ${error.message}`, { cause: error })
  }
  return new WaitError(`hook-harness error: ${(error as Error).message}`, { cause: error })
}

/**
 * Poll the hook-harness relay in-process over every owner from the stored cursor until a batch
 * returns events or a gap, or the timeout signal aborts. Main-branch failures come from
 * `workflow_run` only; pull-request checks are left to pr-shepherd. `failures` counts consecutive
 * `{error}` batches per owner; the caller seeds it from the previous `hh-last.json` and passes it
 * across rounds so a sustained outage still ends the wait across relaunches, and an owner's count
 * resets only when a page for that owner succeeds.
 */
export async function hookHarnessWait(
  ctx: WaitContext,
  repos: string[],
  timeoutMs: number,
  failures: Map<string, number> = new Map(),
): Promise<HarnessResult> {
  const harness = get(await loadState(ctx.dir), 'hookHarness')
  const stored = isObject(harness) ? get(harness, 'cursor') : undefined
  const after = typeof stored === 'string' ? stored : ''
  let cursor: string | undefined
  let started = false

  try {
    const client = await resolveClient(ctx.env)
    const boundedMs = Math.min(Math.max(Math.trunc(timeoutMs), 1), MAX_TIMEOUT_MS)
    const signal = (ctx.timeoutSignal ?? AbortSignal.timeout)(boundedMs)
    const stream = pollEvents({
      ...client,
      owner: ownersIn(repos),
      repos,
      on: ON_PRESETS,
      filters: FILTERS,
      ...(after ? { after } : {}),
      since: new Date(ctx.now().getTime() - SINCE_MS),
      intervalMs: POLL_INTERVAL_MS,
      signal,
      ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
      ...(ctx.sleep ? { sleep: ctx.sleep } : {}),
    })
    for await (const batch of stream) {
      started = true
      const owner = batch.owner.toLowerCase()
      if ('error' in batch) {
        const count = (failures.get(owner) ?? 0) + 1
        failures.set(owner, count)
        if (count >= MAX_CONSECUTIVE_ERRORS) {
          throw new WaitError(
            `hook-harness relay unreachable (${count} consecutive errors for ${owner}): ${batch.error.message}`,
            { cause: batch.error },
          )
        }
        continue
      }
      failures.delete(owner)
      cursor = batch.cursor
      if (batch.gap || batch.events.length > 0) {
        return {
          events: batch.events as unknown as Json[],
          gap: batch.gap,
          cursor: batch.cursor,
        }
      }
    }
  } catch (error) {
    throw mapHarnessError(error, !started)
  }

  return {
    events: [],
    gap: false,
    timedOut: true,
    ...(cursor === undefined ? {} : { cursor }),
  }
}
