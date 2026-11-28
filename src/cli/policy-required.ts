import { loadConfig } from '../config/load.js'
import type { LoopConfig } from '../config/types.js'
import type { AlwaysHumanRequirement } from '../policy/always-human.js'

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
