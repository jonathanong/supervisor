import { tmpdir } from 'node:os'
import {
  ownersOf,
  parseRepoList,
  REPO_LIST_JQ,
  repoListEndpoint,
  scopesForOwner,
  selectRepos,
} from '../config/repos.js'
import { get, isObject, type JsonObject } from '../state/json.js'
import { loadState, parseJson } from '../state/store.js'
import { HarnessExit, WaitError, type WaitContext } from './context.js'

const PRESETS = 'ejection,dependabot-pr,/shepherd,/plan,/fix'
const CLOSED_PRS = '{"event": "pull_request", "action": "closed"}'

async function gh(ctx: WaitContext, args: string[], what: string): Promise<string> {
  const result = await ctx.run('gh', args)
  if (result.code !== 0) {
    throw new WaitError(`${what} exited ${result.code}: ${result.stderr.trim().slice(0, 200)}`)
  }
  return result.stdout
}

/**
 * Fail up front when several owners are configured and `eventWait.hookHarness` is an exact version
 * older than 0.4.0, which waits for one owner only. A range or a tag is passed through unchecked.
 */
export function checkHarnessVersion(ctx: WaitContext): void {
  const version = ctx.loaded.config.eventWait.hookHarness
  const match = /^(\d+)\.(\d+)\.\d+$/.exec(version)
  if (
    match !== null &&
    ownersOf(ctx.loaded).length > 1 &&
    match[1] === '0' &&
    Number(match[2]) < 4
  ) {
    throw new WaitError(
      `eventWait.hookHarness ${version} waits for one owner and the config has several; ` +
        'use hook-harness 0.4.0 or newer',
    )
  }
}

/**
 * `<owner>/<name>` for every live repository the scopes select, owner by owner. A user scope first
 * asks who is signed in: only that user's own listing includes private repositories. A wait that
 * cannot tell fails, rather than quietly watching the public repositories alone.
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
      throw new WaitError(`no repositories match the configuration for ${owner}`)
    }
    all.push(...names.map((name) => `${owner}/${name}`))
  }
  return all
}

/**
 * Run one `hook-harness wait` over every owner from the stored cursor and return the parsed
 * result. Main-branch failures come from `workflow_run` only; pull-request checks are left to
 * pr-shepherd.
 */
export async function hookHarnessWait(
  ctx: WaitContext,
  repos: string[],
  timeout: string,
): Promise<JsonObject> {
  const harness = get(await loadState(ctx.dir), 'hookHarness')
  const cursor = isObject(harness) ? get(harness, 'cursor') : undefined
  const after = typeof cursor === 'string' ? cursor : ''
  const version = ctx.loaded.config.eventWait.hookHarness
  const args = ['-y', `hook-harness@${version}`, 'wait', '--owner', ownersOf(ctx.loaded).join(',')]
  args.push(...(after ? ['--after', after] : ['--since', '10m']))
  args.push('--repo', repos.join(','), '--on', PRESETS)
  args.push('--event', 'workflow_run', '--action', 'completed', '--conclusion', 'failure')
  args.push('--branch', 'main', '--filter', CLOSED_PRS, '--timeout', timeout)
  const result = await ctx.run('npx', args, { cwd: tmpdir(), inheritStderr: true })
  if (result.code !== 0) {
    throw new HarnessExit(result.code)
  }
  const data = parseJson(result.stdout, 'supervisor wait: hook-harness output')
  if (!isObject(data)) {
    throw new WaitError('hook-harness output is not a JSON object')
  }
  return data
}
