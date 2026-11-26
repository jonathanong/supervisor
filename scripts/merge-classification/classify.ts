import { evaluatePolicies } from '../../src/policy/evaluate.js'
import type { EvaluationResult, PolicyFile } from '../../src/policy/types.js'
import type { EvalCase, Label, Priority } from './corpus.js'

/**
 * The supervisor may merge a PR on its own only when all of these hold. `docs/merge-policy.md`
 * reads `claude: approves` as "may merge once the seats are filled" and `claude: comments` as
 * "goes to a person", so a `merge` next step alone is not enough: the evaluator also returns it
 * for a `comments` verdict whose seats are filled, and for a PR no rule covers.
 */
export function allowsMerge(result: EvaluationResult): boolean {
  return (
    result.verdict === 'approves' &&
    result.nextStep.action === 'merge' &&
    result.uncoveredFiles.length === 0 &&
    result.seats.every((seat) => seat.remaining === 0)
  )
}

export type Outcome = 'correct' | 'false-merge' | 'missed-merge'

export interface CaseResult {
  case: EvalCase
  actual: Label
  outcome: Outcome
  policyVerdict: string
  nextStep: string
  /** The evaluator's next step is `merge` although `allowsMerge` is false. */
  nextStepOnlyMerge: boolean
}

export function classifyCase(policies: PolicyFile[], evalCase: EvalCase): CaseResult {
  const result = evaluatePolicies(policies, evalCase.input)
  const actual: Label = allowsMerge(result) ? 'merge' : 'person'
  let outcome: Outcome = 'correct'
  if (actual !== evalCase.label) outcome = actual === 'merge' ? 'false-merge' : 'missed-merge'
  return {
    case: evalCase,
    actual,
    outcome,
    policyVerdict: result.verdict ?? 'none',
    nextStep: result.nextStep.action,
    nextStepOnlyMerge: result.nextStep.action === 'merge' && actual === 'person',
  }
}

export interface Tally {
  cases: number
  met: number
  falseMerges: string[]
  missedMerges: string[]
}

export interface Summary extends Tally {
  byLabel: Record<Label, Tally>
  byPriority: Partial<Record<Priority, Tally>>
  nextStepOnlyMerges: string[]
}

const emptyTally = (): Tally => ({ cases: 0, met: 0, falseMerges: [], missedMerges: [] })

function count(tally: Tally, result: CaseResult): void {
  tally.cases += 1
  if (result.outcome === 'correct') tally.met += 1
  if (result.outcome === 'false-merge') tally.falseMerges.push(result.case.id)
  if (result.outcome === 'missed-merge') tally.missedMerges.push(result.case.id)
}

export function summarize(results: CaseResult[]): Summary {
  const summary: Summary = {
    ...emptyTally(),
    byLabel: { merge: emptyTally(), person: emptyTally() },
    byPriority: {},
    nextStepOnlyMerges: [],
  }
  for (const result of results) {
    count(summary, result)
    count(summary.byLabel[result.case.label], result)
    count((summary.byPriority[result.case.priority] ??= emptyTally()), result)
    if (result.nextStepOnlyMerge) summary.nextStepOnlyMerges.push(result.case.id)
  }
  return summary
}
