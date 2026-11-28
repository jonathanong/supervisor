import { loadPolicySet } from '../policy/run-check.js'
import type { PolicyFile } from '../policy/types.js'
import type { CliIo } from './run.js'

export interface PolicySource {
  dir?: string
  repoDir?: string
  supervisorPolicy: boolean
}

/** Loads the policies. A supervisor policy takes its required always-human paths from the config. */
export async function loadPolicies(args: PolicySource, io: CliIo): Promise<PolicyFile[]> {
  return await loadPolicySet(
    {
      dir: args.dir!,
      supervisorPolicy: args.supervisorPolicy,
      ...(args.repoDir !== undefined ? { repoDir: args.repoDir } : {}),
    },
    io.env,
    process.cwd(),
  )
}
