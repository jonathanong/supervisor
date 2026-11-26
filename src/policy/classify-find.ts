import { join } from 'node:path'
import { extractClassifierCalls } from './condition-validate.js'
import type { PolicyFile } from './types.js'

/** A `repo/<name>` classifier a policy names, and where its definition is, or why it has none. */
export interface FoundClassifier {
  /** The name after `repo/`, with `@<version>` when the policy asks for one. */
  name: string
  /** The `.claude/classifiers` directory beside the policy file that names it. */
  classifiers: string
  /** Set when the call asks for something this runner does not support. */
  error?: string
}

/**
 * Each `repo/<name>` classifier the policies name, once. A classifier named by several policy
 * files takes the definition beside the first, which is the shallowest. A call with a version or
 * with inputs is listed with an error: this runner reads only the unversioned definition and
 * passes no inputs.
 */
export function findClassifiers(
  policies: PolicyFile[],
  rootOf: (policy: PolicyFile) => string,
): FoundClassifier[] {
  const found = new Map<string, FoundClassifier>()
  for (const policy of policies) {
    const calls = policy.rules.flatMap((rule) => [
      ...extractClassifierCalls(rule.if),
      ...rule.override.flatMap((override) => extractClassifierCalls(override.if)),
      ...rule.advisory,
    ])
    for (const call of calls.filter((c) => c.name.startsWith('repo/'))) {
      const name = call.name.slice('repo/'.length)
      const key = call.version === undefined ? name : `${name}@${call.version}`
      if (found.has(key)) continue
      const classifiers = join(rootOf(policy), policy.dir, '.claude', 'classifiers')
      const unsupported =
        call.version !== undefined
          ? 'a versioned classifier (def.v<N>.yml) is not supported'
          : Object.keys(call.inputs).length > 0
            ? 'classifier inputs are not supported'
            : undefined
      found.set(key, { name: key, classifiers, ...(unsupported ? { error: unsupported } : {}) })
    }
  }
  return [...found.values()]
}
