import { evaluateCondition } from './conditions.js'
import { selectRulesForFile } from './discover.js'
import {
  evaluateRuleVerdict,
  evaluateSeat,
  maxDepth,
  ruleReviewDepth,
  strictestClaude,
} from './evaluate-helpers.js'
import { matchesRulePaths, toRelativePath } from './glob.js'
import type {
  AppliedRuleResult,
  ClaudeAction,
  EvaluatedSeat,
  EvaluationFacts,
  EvaluationInput,
  EvaluationResult,
  FileEvaluation,
  NextStep,
  PolicyFile,
  ReviewDepth,
} from './types.js'

export function evaluatePolicies(policies: PolicyFile[], input: EvaluationInput): EvaluationResult {
  const facts: EvaluationFacts = { filesChanged: input.changedFiles.length, ...input.facts }
  const classifiers = input.classifiers ?? {}
  const files: FileEvaluation[] = []
  const uncoveredFiles: string[] = []
  const allSeats: EvaluatedSeat[] = []
  const authorOnlyWarnings: string[] = []
  let overallVerdict: ClaudeAction | null = null
  let overallDepth: ReviewDepth | null = null
  let anyWaitingOnCodeReview = false
  let anyHardBlock = false
  let blockReason = ''

  // TODO(spec): enforce protected-file baseline (1 human, no bots, no claude approves) when uncovered protected paths are changed.
  for (const file of input.changedFiles) {
    const { decidingPolicy, rules } = selectRulesForFile(policies, file)
    const verdictRules = rules.filter((r) => r.verdict !== undefined)
    if (!decidingPolicy || verdictRules.length === 0) {
      uncoveredFiles.push(file)
      files.push({
        file,
        decidingPolicy: decidingPolicy?.path ?? null,
        covered: false,
        noRuleApplies: false,
        unresolvedRuleIf: false,
        rules: [],
        verdict: null,
        seats: [],
        reviewDepth: null,
      })
      continue
    }

    let fileDepth: ReviewDepth | null = null
    for (const rule of rules) fileDepth = maxDepth(fileDepth, ruleReviewDepth(rule))
    overallDepth = maxDepth(overallDepth, fileDepth)

    const applied: AppliedRuleResult[] = []
    let fileVerdict: ClaudeAction | null = null
    const fileSeats: EvaluatedSeat[] = []
    let unresolvedRuleIf = false

    for (const rule of verdictRules) {
      const ruleCount = input.changedFiles.filter((f) => {
        const rel = toRelativePath(f, rule.baseDir)
        return rel !== null && matchesRulePaths(rel, rule.paths)
      }).length
      const ctx = {
        facts,
        ruleFacts: { filesChanged: ruleCount, filesAdded: ruleCount, filesRemoved: 0 },
        classifiers,
      }
      const ifRes = evaluateCondition(rule.if, ctx)
      if (ifRes === 'false') continue
      if (ifRes === 'unknown') {
        unresolvedRuleIf = true
        anyHardBlock = true
        blockReason = `Rule '${rule.purpose}' condition could not be evaluated`
        continue
      }
      const { verdict, overrideIndex, waitingOnCodeReview } = evaluateRuleVerdict(
        rule,
        facts,
        ruleCount,
        classifiers,
      )
      if (waitingOnCodeReview) anyWaitingOnCodeReview = true
      fileVerdict = strictestClaude(fileVerdict, verdict.claude)
      const evaluatedSeats = verdict.seats.map((s) => evaluateSeat(s, facts))
      const authorOnlySeats = evaluatedSeats.some((s) => s.authorOnly)
      if (authorOnlySeats) {
        const warning = `Rule '${rule.purpose}' (${rule.sourceFile}) has seats that can be met by the author alone`
        if (!authorOnlyWarnings.includes(warning)) authorOnlyWarnings.push(warning)
      }
      fileSeats.push(...evaluatedSeats)
      allSeats.push(...evaluatedSeats)
      applied.push({
        purpose: rule.purpose,
        sourceFile: rule.sourceFile,
        verdict,
        overrideIndex,
        waitingOnClassifier: waitingOnCodeReview,
        authorOnlySeats,
      })
    }

    const noRuleApplies = applied.length === 0 && !unresolvedRuleIf
    if (noRuleApplies) {
      anyHardBlock = true
      blockReason = `No rule applies to '${file}'`
    }
    if (fileVerdict) overallVerdict = strictestClaude(overallVerdict, fileVerdict)
    files.push({
      file,
      decidingPolicy: decidingPolicy.path,
      covered: true,
      noRuleApplies,
      unresolvedRuleIf,
      rules: applied,
      verdict: fileVerdict,
      seats: fileSeats,
      reviewDepth: fileDepth,
    })
  }

  const unmetSeats = allSeats.filter((s) => s.remaining > 0)
  let nextStep: NextStep
  if (anyHardBlock) {
    nextStep = { action: 'escalate', reason: blockReason }
  } else if (
    anyWaitingOnCodeReview &&
    (overallVerdict === 'blocks' || unmetSeats.length > 0 || overallVerdict === 'comments')
  ) {
    nextStep = { action: 'request_review', depth: overallDepth ?? 'standard' }
  } else if (overallVerdict === 'blocks') {
    nextStep = { action: 'escalate', reason: 'A matching rule blocks merge' }
  } else if (overallVerdict !== 'approves' || uncoveredFiles.length > 0) {
    // Only an `approves` verdict on every changed file lets the supervisor merge: `comments`, a
    // file no rule covers, and an empty change all go to a person, whatever the seats say.
    nextStep = {
      action: 'escalate',
      reason: 'Not every changed file has a rule that approves the merge',
    }
  } else if (unmetSeats.length > 0) {
    nextStep = {
      action: 'escalate',
      reason: `${unmetSeats.length} seat requirement(s) still unmet`,
    }
  } else {
    nextStep = { action: 'merge' }
  }

  return {
    files,
    uncoveredFiles,
    verdict: overallVerdict,
    seats: allSeats,
    reviewDepth: overallDepth,
    authorOnlyWarnings,
    nextStep,
  }
}
