import { evaluatePolicies } from './evaluate.js'
import type { CheckState } from './facts-checks.js'
import type { PullFacts } from './facts.js'
import type { EvaluationResult, NextStep, PolicyFile } from './types.js'

/** The policy's evaluation of one head, with the next step also held by its checks. */
export interface PullCheckResult extends EvaluationResult {
  pull: PullFacts['pull']
  checks: CheckState
  blockers: string[]
  /** What the policy alone says, before the checks and the blockers. */
  policyNextStep: NextStep
}

function checksReason(checks: CheckState): string {
  if (checks.state === 'failure') return `Checks failed on the head: ${checks.failing.join(', ')}`
  if (checks.state === 'pending') {
    return `Checks have not finished on the head: ${checks.pending.join(', ')}`
  }
  return 'The head has no checks'
}

/**
 * Evaluate collected facts. A blocker always escalates. A merge the policy allows still
 * escalates unless every check on the head passed; CI stays outside the policy itself.
 */
export function checkPull(policies: PolicyFile[], facts: PullFacts): PullCheckResult {
  const result = evaluatePolicies(policies, facts)
  let nextStep = result.nextStep
  if (facts.blockers.length > 0) {
    nextStep = { action: 'escalate', reason: facts.blockers.join('; ') }
  } else if (nextStep.action === 'merge' && facts.checks.state !== 'success') {
    nextStep = { action: 'escalate', reason: checksReason(facts.checks) }
  }
  return {
    ...result,
    nextStep,
    pull: facts.pull,
    checks: facts.checks,
    blockers: facts.blockers,
    policyNextStep: result.nextStep,
  }
}
