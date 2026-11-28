import { readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { AlwaysHumanRequirement } from '../policy/always-human.js'
import { expandHome } from './defaults.js'
import { loadConfig, type LoadedConfig } from './load.js'
import type { LoopConfig, Scope } from './types.js'

export interface PolicyConfigOverrides {
  dir?: string
  repoDir?: string
  supervisorPolicy?: boolean
}

export interface ResolvedPolicyConfig {
  dir: string
  supervisorPolicy: boolean
  requiredAlwaysHuman?: readonly AlwaysHumanRequirement[]
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

async function resolvePolicyDir(loaded: LoadedConfig): Promise<string> {
  const expanded = expandHome(loaded.config.mergeAuthority.policy)
  return isAbsolute(expanded) ? expanded : resolve(dirname(await realpath(loaded.path)), expanded)
}

/**
 * Resolves `mergeAuthority.policy`, `requiredAlwaysHuman`, and any configured local checkout for
 * `repository` from the supervisor config (`$SUPERVISOR_CONFIG`, else `.supervisor.json` in `cwd`),
 * letting explicit `overrides` win. A relative policy path resolves against the real path of the
 * config file's directory. When `overrides.dir` is given, policy-directory and checkout resolution
 * from config are skipped; only the explicit directory (and explicit `overrides.repoDir`, if
 * given) is returned (loading a supervisor policy still reads `requiredAlwaysHuman` from config).
 */
export async function resolvePolicyFromConfig(
  env: Record<string, string | undefined>,
  cwd: string,
  repository?: string,
  overrides: PolicyConfigOverrides = {},
): Promise<ResolvedPolicyConfig> {
  if (overrides.dir !== undefined) {
    return {
      dir: overrides.dir,
      supervisorPolicy: overrides.supervisorPolicy === true,
      ...(overrides.repoDir !== undefined ? { repoDir: overrides.repoDir } : {}),
    }
  }
  const loaded = await loadConfig(env, cwd)
  const dir = await resolvePolicyDir(loaded)
  const repoDir =
    overrides.repoDir !== undefined
      ? overrides.repoDir
      : repository !== undefined
        ? await configuredRepoDir(loaded.config.scopes, repository)
        : undefined
  return {
    dir,
    supervisorPolicy: true,
    requiredAlwaysHuman: loaded.config.mergeAuthority.requiredAlwaysHuman ?? [],
    ...(repoDir !== undefined ? { repoDir } : {}),
  }
}
