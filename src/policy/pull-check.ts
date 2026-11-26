import { evaluatePolicies } from './evaluate.js'
import type { Readiness } from './facts-readiness.js'
import type { PullFacts } from './facts.js'
import type { ClassifierResult, EvaluationResult, NextStep, PolicyFile } from './types.js'

/** The policy's evaluation of one head, with the next step also held by pr-shepherd's answer. */
export interface PullCheckResult extends EvaluationResult {
  pull: PullFacts['pull']
  readiness: Readiness
  blockers: string[]
  /** The classifier results the evaluation was given; empty when it was given none. */
  classifiers: Record<string, ClassifierResult>
  /** What the policy alone says, before pr-shepherd's answer and the blockers. */
  policyNextStep: NextStep
}

function shepherdReason(readiness: Readiness): string {
  const why = readiness.summary ? `: ${readiness.summary}` : ''
  return `pr-shepherd says "${readiness.action}", so the head is not ready to merge${why}`
}

/**
 * Evaluate collected facts. A blocker always escalates. A merge the policy allows waits for
 * pr-shepherd: unless it would merge the head, the next step is to run it. CI stays outside the
 * policy itself, and a pending check needs no person.
 */
export function checkPull(policies: PolicyFile[], facts: PullFacts): PullCheckResult {
  const result = evaluatePolicies(policies, facts)
  let nextStep = result.nextStep
  if (facts.blockers.length > 0) {
    nextStep = { action: 'escalate', reason: facts.blockers.join('; ') }
  } else if (nextStep.action === 'merge' && !facts.readiness.ready) {
    nextStep = { action: 'shepherd', reason: shepherdReason(facts.readiness) }
  }
  return {
    ...result,
    nextStep,
    pull: facts.pull,
    readiness: facts.readiness,
    blockers: facts.blockers,
    classifiers: facts.classifiers ?? {},
    policyNextStep: result.nextStep,
  }
}
