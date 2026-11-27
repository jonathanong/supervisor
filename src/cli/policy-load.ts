import { discoverPolicies } from '../policy/discover.js'
import { loadLayeredPolicies } from '../policy/layers.js'
import type { PolicyFile } from '../policy/types.js'
import { requiredAlwaysHumanFromConfig } from './policy-required.js'
import type { CliIo } from './run.js'

export interface PolicySource {
  dir?: string
  repoDir?: string
  supervisorPolicy: boolean
}

/** Loads the policies. A supervisor policy takes its required always-human paths from the config. */
export async function loadPolicies(args: PolicySource, io: CliIo): Promise<PolicyFile[]> {
  if (!args.repoDir && !args.supervisorPolicy) return await discoverPolicies(args.dir!)
  const requiredAlwaysHuman = await requiredAlwaysHumanFromConfig(io.env, process.cwd())
  return args.repoDir
    ? await loadLayeredPolicies(args.dir!, args.repoDir, { requiredAlwaysHuman })
    : await discoverPolicies(args.dir!, { supervisorPolicy: true, requiredAlwaysHuman })
}
