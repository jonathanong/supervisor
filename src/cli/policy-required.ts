import { loadConfig } from '../config/load.js'
import type { AlwaysHumanRequirement } from '../policy/always-human.js'

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
  try {
    const { config } = await loadConfig(env, cwd)
    return config.mergeAuthority.requiredAlwaysHuman ?? []
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause
    if (!env.SUPERVISOR_CONFIG && cause?.code === 'ENOENT') return []
    throw error
  }
}
