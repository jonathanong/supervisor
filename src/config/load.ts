import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateConfigData } from '../cli/config-validate.js'
import { applyDefaults, expandHome } from './defaults.js'
import type { LoopConfig, SupervisorConfig } from './types.js'

/** A configuration file that is missing, malformed, or lacks a key a command needs. */
export class ConfigError extends Error {}

export interface LoadedConfig {
  path: string
  config: LoopConfig
}

/** `$SUPERVISOR_CONFIG`, else `.supervisor.json` in the current directory. */
export function resolveConfigPath(env: Record<string, string | undefined>, cwd: string): string {
  return env.SUPERVISOR_CONFIG ? expandHome(env.SUPERVISOR_CONFIG) : join(cwd, '.supervisor.json')
}

export async function loadConfig(
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<LoadedConfig> {
  const path = resolveConfigPath(env, cwd)
  let data: unknown
  try {
    data = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new ConfigError(`supervisor config ${path}: ${(error as Error).message}`, {
      cause: error,
    })
  }
  const result = validateConfigData(data)
  if (!result.valid) {
    const details = result.errors.map((error) => `${error.path}: ${error.message}`).join('; ')
    throw new ConfigError(`supervisor config ${path}: ${details}`)
  }
  return { path, config: applyDefaults(data as SupervisorConfig) }
}

/** The state directory, for a command that cannot run without one. */
export function requireStateDir(loaded: LoadedConfig): string {
  if (loaded.config.stateDir === undefined) {
    throw new ConfigError(`supervisor config ${loaded.path}: stateDir is required by this command`)
  }
  return loaded.config.stateDir
}
