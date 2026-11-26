import type { AlwaysHumanRequirement } from './always-human.js'
import { discoverPolicies } from './discover.js'
import { PolicyLoadError, type PolicyFile } from './types.js'

/** Prefix on the supervisor policy's path, to tell it from a repository's `.claude/approvals.yml`. */
export const SUPERVISOR_POLICY_LABEL = 'supervisor:'

export interface LayeredPolicyOptions {
  /** The paths the supervisor policy must send to a person. Defaults to `DEFAULT_ALWAYS_HUMAN`. */
  requiredAlwaysHuman?: readonly AlwaysHumanRequirement[]
}

/**
 * Loads the supervisor policy as the root and a repository's own policy files below it.
 *
 * - `supervisorDir` is a directory outside the repository that holds `.claude/approvals.yml`. It
 *   may use the supervisor-only facts `pr/repository` and `pr/labels`.
 * - `repoDir` is a checkout of the repository. Its `.supervisor/approvals.yml`, and the
 *   `.supervisor/approvals.yml` of any directory below, are read with Claude Approvals' vocabulary
 *   alone, so a supervisor-only fact there refuses the file.
 *
 * The files combine the way the format combines a root file and a directory's file: the nearest
 * enforcing file with a matching verdict rule decides, and of the files above it only the rules
 * marked `nested: inherit` still hold. A repository file inherits the supervisor policy's locals.
 *
 * The supervisor policy is refused unless its always-human rules are present: `nested: inherit`
 * rules that never approve, one matching every path in `opts.requiredAlwaysHuman`. Those are the
 * rules a repository file cannot remove.
 *
 * A pull request that changes a policy file is judged by the default branch's copy. This function
 * reads whatever is on disk, so `repoDir` must be a checkout of the default branch, never of the
 * pull request's head.
 */
export async function loadLayeredPolicies(
  supervisorDir: string,
  repoDir: string,
  opts: LayeredPolicyOptions = {},
): Promise<PolicyFile[]> {
  const above = await discoverPolicies(supervisorDir, { ...opts, supervisorPolicy: true })
  // discoverPolicies refuses a supervisor policy that has no root file.
  const root = above.find((policy) => policy.dir === '')!
  const nested = above.filter((policy) => policy !== root)
  if (nested.length > 0) {
    throw new PolicyLoadError(
      nested.map((policy) => ({
        file: `${SUPERVISOR_POLICY_LABEL}${policy.path}`,
        path: '$',
        message:
          'A directory policy file beside the supervisor policy cannot be combined with a repository; move it into the repository as .supervisor/approvals.yml',
      })),
    )
  }

  const path = `${SUPERVISOR_POLICY_LABEL}${root.path}`
  const supervisorRoot: PolicyFile = {
    ...root,
    path,
    rules: root.rules.map((rule) => ({ ...rule, sourceFile: path })),
    supervisorRoot: true,
  }
  const below = await discoverPolicies(repoDir, {
    folder: '.supervisor',
    inheritedLocals: root.locals,
  })
  return [supervisorRoot, ...below]
}
