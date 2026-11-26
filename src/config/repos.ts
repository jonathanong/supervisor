import { ConfigError, type LoadedConfig } from './load.js'
import type { Scope } from './types.js'

export interface ListedRepo {
  name: string
  fork: boolean
}

/** The `--jq` filter for the repository listing: one `name<TAB>fork` line per live repository. */
export const REPO_LIST_JQ = '.[] | select(.archived | not) | [.name, .fork] | @tsv'

/** Every scope configured for one owner; an owner with none is a configuration error. */
export function scopesForOwner(loaded: LoadedConfig, owner: string): Scope[] {
  const scopes = loaded.config.scopes.filter((scope) => scope.owner === owner)
  if (scopes.length === 0) {
    throw new ConfigError(`supervisor config ${loaded.path}: no scope has owner ${owner}`)
  }
  return scopes
}

/** The REST path that lists a scope's repositories: organizations and users differ. */
export function repoListEndpoint(scope: Scope): string {
  return `${scope.kind === 'org' ? 'orgs' : 'users'}/${scope.owner}/repos?per_page=100`
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

/** The sorted names one owner's scopes select from that owner's listed repositories. */
export function selectRepos(scopes: Scope[], listed: ListedRepo[]): string[] {
  return listed
    .filter((repo) => scopes.some((scope) => selects(scope, repo)))
    .map((repo) => repo.name)
    .sort()
}
