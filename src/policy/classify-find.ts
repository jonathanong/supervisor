import { join } from 'node:path'
import { extractClassifierCalls } from './condition-validate.js'
import type { PolicyFile } from './types.js'

/** A `repo/<name>` classifier a policy names, and where its definition is, or why it has none. */
export interface FoundClassifier {
  /** The name after `repo/`. */
  name: string
  /** The `.claude/classifiers` directory beside the policy file that names it. */
  classifiers: string
  /** Set when the call asks for something this runner does not support. */
  error?: string
}

/**
 * Each `repo/<name>` classifier the policies name, once. A classifier named by several policy
 * files takes the definition beside the first, which is the shallowest. This runner reads only
 * the unversioned definition and passes no inputs. So when any call of a name has a version or
 * inputs, the name is listed with an error and gets no result at all: the evaluator looks a
 * result up by name, and would judge that call on an answer given without its version or inputs.
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
      const unsupported =
        call.version !== undefined
          ? 'a versioned classifier (def.v<N>.yml) is not supported'
          : Object.keys(call.inputs).length > 0
            ? 'classifier inputs are not supported'
            : undefined
      const earlier = found.get(name)
      if (earlier) {
        if (unsupported && !earlier.error) earlier.error = unsupported
        continue
      }
      const classifiers = join(rootOf(policy), policy.dir, '.claude', 'classifiers')
      found.set(name, { name, classifiers, ...(unsupported ? { error: unsupported } : {}) })
    }
  }
  return [...found.values()]
}
