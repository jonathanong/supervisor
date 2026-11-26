import { tmpdir } from 'node:os'
import {
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

/** `<owner>/<name>` for every live repository this owner's scopes select. */
export async function listRepositories(ctx: WaitContext): Promise<string[]> {
  const scopes = scopesForOwner(ctx.loaded, ctx.owner)
  const args = ['api', '--paginate', repoListEndpoint(scopes[0]!), '--jq', REPO_LIST_JQ]
  const listed = await ctx.run('gh', args)
  if (listed.code !== 0) {
    throw new WaitError(`gh exited ${listed.code}: ${listed.stderr.trim().slice(0, 200)}`)
  }
  const names = selectRepos(scopes, parseRepoList(listed.stdout))
  if (names.length === 0) {
    throw new WaitError('no repositories match the configuration')
  }
  return names.map((name) => `${ctx.owner}/${name}`)
}

/**
 * Run one `hook-harness wait` for this owner from its stored cursor and return the parsed result.
 * Main-branch failures come from `workflow_run` only; pull-request checks are left to pr-shepherd.
 */
export async function hookHarnessWait(
  ctx: WaitContext,
  repos: string[],
  timeout: string,
): Promise<JsonObject> {
  const harness = get(await loadState(ctx.dir), 'hookHarness')
  const mine = isObject(harness) ? get(harness, ctx.owner) : undefined
  const after = isObject(mine) && typeof mine.cursor === 'string' ? mine.cursor : ''
  const version = ctx.loaded.config.eventWait.hookHarness
  const args = ['-y', `hook-harness@${version}`, 'wait', '--owner', ctx.owner]
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
