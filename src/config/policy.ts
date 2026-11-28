import { readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { AlwaysHumanRequirement } from '../policy/always-human.js'
import { expandHome } from './defaults.js'
import { loadConfig } from './load.js'
import type { LoopConfig, Scope } from './types.js'

export interface ResolvedPolicyConfig {
  dir: string
  requiredAlwaysHuman: readonly AlwaysHumanRequirement[]
  repoDir?: string
}

async function loadOptionalConfig(
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<LoopConfig | undefined> {
  try {
    return (await loadConfig(env, cwd)).config
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause
    if (!env.SUPERVISOR_CONFIG && cause?.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * The always-human paths the config requires of the supervisor policy:
 * `mergeAuthority.requiredAlwaysHuman`, or none. With no `$SUPERVISOR_CONFIG` and no
 * `.supervisor.json` in `cwd`, nothing is required. A config that is named but missing, or that is
 * unreadable or invalid, throws.
 */
export async function requiredAlwaysHumanFromConfig(
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<readonly AlwaysHumanRequirement[]> {
  return (await loadOptionalConfig(env, cwd))?.mergeAuthority.requiredAlwaysHuman ?? []
}

/**
 * The trusted final reviewer account from `finalReview.reviewer`, or undefined when unset or when
 * no config file is present and `$SUPERVISOR_CONFIG` is unset.
 */
export async function reviewerFromConfig(
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<string | undefined> {
  return (await loadOptionalConfig(env, cwd))?.finalReview.reviewer
}

async function findCheckoutDir(root: string, repo: string): Promise<string | undefined> {
  try {
    const entries = await readdir(root)
    const lower = repo.toLowerCase()
    const match =
      entries.find((name) => name === repo) ?? entries.find((name) => name.toLowerCase() === lower)
    if (match === undefined) return undefined
    const candidate = join(root, match)
    return (await stat(candidate)).isDirectory() ? candidate : undefined
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined
    throw error
  }
}

async function configuredRepoDir(
  scopes: readonly Scope[],
  repository: string,
): Promise<string | undefined> {
  const [owner, repo] = repository.split('/') as [string, string]
  const lowerOwner = owner.toLowerCase()
  const lowerRepo = repo.toLowerCase()
  const matchesRepo = (name: string) => name.toLowerCase() === lowerRepo
  const scope = scopes.find(
    (entry) =>
      entry.owner.toLowerCase() === lowerOwner &&
      (entry.repos === '*' || entry.repos.some(matchesRepo)) &&
      !(entry.excludedRepos ?? []).some(matchesRepo) &&
      entry.checkoutRoot !== undefined,
  )
  if (!scope) return undefined
  return await findCheckoutDir(scope.checkoutRoot!, repo)
}

/**
 * Resolves `mergeAuthority.policy`, `requiredAlwaysHuman`, and any configured local checkout for
 * `repository` from the supervisor config (`$SUPERVISOR_CONFIG`, else `.supervisor.json` in `cwd`).
 * A relative policy path resolves against the real path of the config file's directory.
 */
export async function resolvePolicyFromConfig(
  env: Record<string, string | undefined>,
  cwd: string,
  repository: string,
): Promise<ResolvedPolicyConfig> {
  const { path, config } = await loadConfig(env, cwd)
  const expanded = expandHome(config.mergeAuthority.policy)
  const dir = isAbsolute(expanded) ? expanded : resolve(dirname(await realpath(path)), expanded)
  const repoDir = await configuredRepoDir(config.scopes, repository)
  return {
    dir,
    requiredAlwaysHuman: config.mergeAuthority.requiredAlwaysHuman ?? [],
    ...(repoDir !== undefined ? { repoDir } : {}),
  }
}
