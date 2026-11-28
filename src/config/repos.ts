import { ConfigError, type LoadedConfig } from './load.js'
import type { Scope } from './types.js'

export interface ListedRepo {
  name: string
  fork: boolean
}

/** The `--jq` filter for the repository listing: one `name<TAB>fork` line per live repository. */
export const REPO_LIST_JQ = '.[] | select((.archived or .disabled) | not) | [.name, .fork] | @tsv'

/** Every distinct scope owner, in the order the scopes list them. */
export function ownersOf(loaded: LoadedConfig): string[] {
  return [...new Set(loaded.config.scopes.map((scope) => scope.owner))]
}

/** Every scope configured for one owner; an owner with none is a configuration error. */
export function scopesForOwner(loaded: LoadedConfig, owner: string): Scope[] {
  const scopes = loaded.config.scopes.filter((scope) => scope.owner === owner)
  if (scopes.length === 0) {
    throw new ConfigError(`supervisor config ${loaded.path}: no scope has owner ${owner}`)
  }
  return scopes
}

/**
 * The REST path that lists a scope's repositories. `users/<owner>/repos` returns public
 * repositories only, so a user scope whose owner is the signed-in user (`login`) lists through
 * `user/repos`, which includes the private ones that user owns. Another user's scope has only the
 * public endpoint.
 */
export function repoListEndpoint(scope: Scope, login?: string): string {
  if (scope.kind === 'org') {
    return `orgs/${scope.owner}/repos?per_page=100`
  }
  return login?.toLowerCase() === scope.owner.toLowerCase()
    ? 'user/repos?affiliation=owner&per_page=100'
    : `users/${scope.owner}/repos?per_page=100`
}

export function parseRepoList(stdout: string): ListedRepo[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name, fork] = line.split('\t')
      return { name: name!, fork: fork === 'true' }
    })
}

function selects(scope: Scope, repo: ListedRepo): boolean {
  if (scope.repos !== '*' && !scope.repos.includes(repo.name)) {
    return false
  }
  if (scope.excludeForks === true && repo.fork) {
    return false
  }
  return !(scope.excludedRepos ?? []).includes(repo.name)
}

/**
 * True when every scope that covers `<owner>/<name>` runs in report mode, so the loop cannot act
 * on the repository. A repository no scope names counts as enforced: nothing says to skip it.
 * Fork status is not known here, so `excludeForks` does not narrow a scope.
 */
export function inReportMode(loaded: LoadedConfig, repo: string): boolean {
  const at = repo.indexOf('/')
  const owner = repo.slice(0, at).toLowerCase()
  const name = repo.slice(at + 1)
  const covering = loaded.config.scopes.filter(
    (scope) =>
      scope.owner.toLowerCase() === owner &&
      (scope.repos === '*' || scope.repos.includes(name)) &&
      !(scope.excludedRepos ?? []).includes(name),
  )
  return covering.length > 0 && covering.every((scope) => scope.mode === 'report')
}

/** The sorted names one owner's scopes select from that owner's listed repositories. */
export function selectRepos(scopes: Scope[], listed: ListedRepo[]): string[] {
  return listed
    .filter((repo) => scopes.some((scope) => selects(scope, repo)))
    .map((repo) => repo.name)
    .sort()
}
