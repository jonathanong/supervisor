import { matchesRulePaths } from './glob.js'
import {
  PolicyLoadError,
  type ClaudeAction,
  type PolicyFile,
  type PolicyRule,
  type SeatSet,
} from './types.js'

/**
 * One class of path that must always go to a person. Two globs cannot be compared directly, so a
 * requirement lists sample paths, and it is met when an always-human rule matches every sample.
 */
export interface AlwaysHumanRequirement {
  name: string
  samples: readonly string[]
}

/**
 * An example list of what a supervisor policy might be required to send to a person: CI workflow
 * definitions, release and signing paths, and the files that decide what may merge. Nothing
 * requires it by default; the eval and the tests pass it explicitly, and an installation lists its
 * own in `mergeAuthority.requiredAlwaysHuman`.
 */
export const EXAMPLE_ALWAYS_HUMAN: readonly AlwaysHumanRequirement[] = [
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

/** A seat that only a person can fill: it names someone, and nobody it names is a bot. */
function isHumanSeat(seat: SeatSet): boolean {
  const named = seat.from.filter((who) => !who.startsWith('!'))
  return seat.count > 0 && named.length > 0 && named.every((who) => !who.startsWith('bot:'))
}

/** A verdict that goes to a person: it blocks, or it comments and asks for a human seat. */
function asksAPerson(claude: ClaudeAction, seats: SeatSet[]): boolean {
  return claude === 'blocks' || (claude === 'comments' && seats.some(isHumanSeat))
}

/**
 * An always-human rule holds in every repository and always goes to a person: it is enforced,
 * marked `nested: inherit`, has no `if`, and its verdict, alone and under each override, blocks
 * or comments with a human seat. A rule that comments with no seat, or with only a bot's, asks
 * nobody.
 */
export function isAlwaysHumanRule(rule: PolicyRule): boolean {
  const { verdict } = rule
  return (
    rule.mode === 'enforce' &&
    rule.nested === 'inherit' &&
    rule.if.kind === 'literal' &&
    rule.if.value &&
    verdict !== undefined &&
    asksAPerson(verdict.claude, verdict.seats) &&
    rule.override.every((override) =>
      asksAPerson(
        override.verdict?.claude ?? verdict.claude,
        override.verdict?.seats ?? verdict.seats,
      ),
    )
  )
}

/**
 * Refuses a supervisor policy whose root file lacks an always-human rule for any required path.
 * `root` is the policy file at the top of the supervisor policy directory, if there is one.
 */
export function assertAlwaysHumanRules(
  root: PolicyFile,
  file: string,
  required: readonly AlwaysHumanRequirement[],
): void {
  const rules = root.rules.filter(isAlwaysHumanRule)
  const errors = required.flatMap((requirement) => {
    const missing = requirement.samples.filter(
      (sample) => !rules.some((rule) => matchesRulePaths(sample, rule.paths)),
    )
    if (missing.length === 0) return []
    const message = `Supervisor policy must send ${requirement.name} to a person: no rule with 'nested: inherit', no 'if' and a verdict that blocks or asks for a human seat matches ${missing.map((sample) => `'${sample}'`).join(', ')}`
    return [{ file, path: 'rules', message }]
  })
  if (errors.length > 0) throw new PolicyLoadError(errors)
}
