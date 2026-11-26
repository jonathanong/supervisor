import { matchesRulePaths } from './glob.js'
import { PolicyLoadError, type PolicyFile, type PolicyRule } from './types.js'

/**
 * One class of path that must always go to a person. Two globs cannot be compared directly, so a
 * requirement lists sample paths, and it is met when an always-human rule matches every sample.
 */
export interface AlwaysHumanRequirement {
  name: string
  samples: readonly string[]
}

/**
 * What a supervisor policy must send to a person unless the caller passes its own list: CI
 * workflow definitions, release and signing paths, and the files that decide what may merge.
 * An installation whose release or signing code lives elsewhere passes its own samples.
 */
export const DEFAULT_ALWAYS_HUMAN: readonly AlwaysHumanRequirement[] = [
  { name: 'CI workflow definitions', samples: ['.github/workflows/ci.yml'] },
  { name: 'release paths', samples: ['release/publish.sh'] },
  { name: 'signing paths', samples: ['signing/sign.sh'] },
  {
    name: 'policy files',
    samples: [
      '.supervisor/approvals.yml',
      '.supervisor/approvals.yaml',
      'packages/example/.supervisor/approvals.yml',
      '.claude/approvals.yml',
      '.claude/approvals.yaml',
      'packages/example/.claude/approvals.yml',
    ],
  },
  {
    name: 'classifier definitions',
    samples: [
      '.claude/classifiers/example/def.yml',
      '.claude/classifiers/example/prompt.md',
      'packages/example/.claude/classifiers/example/def.yml',
    ],
  },
]

/**
 * An always-human rule holds in every repository and can never let the supervisor merge: it is
 * enforced, marked `nested: inherit`, has no `if`, and neither its verdict nor any override of it
 * says `claude: approves`.
 */
export function isAlwaysHumanRule(rule: PolicyRule): boolean {
  return (
    rule.mode === 'enforce' &&
    rule.nested === 'inherit' &&
    rule.if.kind === 'literal' &&
    rule.if.value &&
    rule.verdict !== undefined &&
    rule.verdict.claude !== 'approves' &&
    rule.override.every((override) => override.verdict?.claude !== 'approves')
  )
}

/**
 * Refuses a supervisor policy whose root file lacks an always-human rule for any required path.
 * `root` is the policy file at the top of the supervisor policy directory, if there is one.
 */
export function assertAlwaysHumanRules(
  root: PolicyFile | undefined,
  file: string,
  required: readonly AlwaysHumanRequirement[],
): void {
  const rules = (root?.rules ?? []).filter(isAlwaysHumanRule)
  const errors = required.flatMap((requirement) => {
    const missing = requirement.samples.filter(
      (sample) => !rules.some((rule) => matchesRulePaths(sample, rule.paths)),
    )
    if (missing.length === 0) return []
    const message = `Supervisor policy must send ${requirement.name} to a person: no rule with 'nested: inherit', no 'if' and no 'claude: approves' matches ${missing.map((sample) => `'${sample}'`).join(', ')}`
    return [{ file, path: 'rules', message }]
  })
  if (errors.length > 0) throw new PolicyLoadError(errors)
}
