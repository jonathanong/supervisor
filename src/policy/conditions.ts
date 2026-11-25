import { matchGlob } from './glob.js'
import {
  DEPTH_RANK,
  DIFF_RANK,
  SEVERITY_RANK,
  accountMatchesList,
  compareNumbers,
} from './people.js'
import type {
  ClassifierCall,
  ClassifierResult,
  ComparisonOp,
  ConditionExpr,
  ConditionRhs,
  DiffRating,
  EvaluationFacts,
  ReviewDepth,
  SeverityLevel,
  TriBool,
} from './types.js'

export interface EvalContext {
  facts: EvaluationFacts
  ruleFacts: { filesChanged: number; filesAdded: number; filesRemoved: number }
  classifiers: Record<string, ClassifierResult>
}

function getNumericFact(name: string, ctx: EvalContext): number | undefined {
  switch (name) {
    case 'pr/files_changed':
      return ctx.facts.filesChanged
    case 'pr/files_added':
      return ctx.facts.filesAdded
    case 'pr/files_removed':
      return ctx.facts.filesRemoved
    case 'pr/diff_lines':
      return ctx.facts.diffLines
    case 'rule/files_changed':
      return ctx.ruleFacts.filesChanged
    case 'rule/files_added':
      return ctx.ruleFacts.filesAdded
    case 'rule/files_removed':
      return ctx.ruleFacts.filesRemoved
    default:
      return undefined
  }
}

function rhsToList(rhs: ConditionRhs): string[] {
  return rhs.kind === 'list' ? rhs.items : [String((rhs as { value: string | number }).value)]
}

function evalClassifier(
  call: ClassifierCall,
  op: ComparisonOp,
  rhs: ConditionRhs,
  ctx: EvalContext,
): TriBool {
  const versionKey = call.version !== undefined ? `${call.name}@${call.version}` : call.name
  const result = ctx.classifiers[versionKey] ?? ctx.classifiers[call.name]
  if (!result) return 'unknown'

  if (rhs.kind === 'string' && (rhs.value === 'error' || rhs.value === 'incomplete')) {
    return result.status === rhs.value ? 'true' : 'false'
  }
  if (result.status !== 'complete') return 'unknown'

  if (call.name === 'claude/code_review' && typeof call.inputs.level === 'string') {
    const required = DEPTH_RANK[call.inputs.level as ReviewDepth]
    const actual = result.level ? DEPTH_RANK[result.level] : 0
    if (actual < required) return 'unknown'
  }

  if (call.output === 'severity') {
    if (!result.severity || rhs.kind !== 'string') return 'unknown'
    const targetRank = SEVERITY_RANK[rhs.value as SeverityLevel]
    if (targetRank === undefined) return 'unknown'
    return compareNumbers(SEVERITY_RANK[result.severity], op, targetRank) ? 'true' : 'false'
  }

  if (call.name === 'claude/diff') {
    if (typeof result.value !== 'string' || rhs.kind !== 'string') return 'unknown'
    const actualRank = DIFF_RANK[result.value as DiffRating]
    const targetRank = DIFF_RANK[rhs.value as DiffRating]
    if (actualRank === undefined || targetRank === undefined) return 'unknown'
    return compareNumbers(actualRank, op, targetRank) ? 'true' : 'false'
  }

  const rawValue = call.output ? result.outputs?.[call.output] : result.value
  if (rawValue === undefined) return 'unknown'
  if (typeof rawValue === 'number' && rhs.kind === 'number') {
    return compareNumbers(rawValue, op, rhs.value) ? 'true' : 'false'
  }
  const actualStr = String(rawValue)
  if (rhs.kind === 'list') {
    const matched = rhs.items.includes(actualStr)
    return (op === '=' ? matched : !matched) ? 'true' : 'false'
  }
  const targetStr = String((rhs as { value: string | number }).value)
  return (op === '=' ? actualStr === targetStr : actualStr !== targetStr) ? 'true' : 'false'
}

export function evaluateCondition(expr: ConditionExpr, ctx: EvalContext): TriBool {
  if (expr.kind === 'literal') return expr.value ? 'true' : 'false'

  if (expr.kind === 'logical') {
    let sawUnknown = false
    for (const child of expr.items) {
      const value = evaluateCondition(child, ctx)
      if (expr.op === 'AND' && value === 'false') return 'false'
      if (expr.op === 'OR' && value === 'true') return 'true'
      if (value === 'unknown') sawUnknown = true
    }
    if (sawUnknown) return 'unknown'
    return expr.op === 'AND' ? 'true' : 'false'
  }

  if (expr.lhs.kind === 'classifier') {
    return evalClassifier(expr.lhs.call, expr.op, expr.rhs, ctx)
  }

  const { name } = expr.lhs
  const numVal = getNumericFact(name, ctx)
  if (
    numVal !== undefined ||
    name.endsWith('_changed') ||
    name.endsWith('_added') ||
    name.endsWith('_removed') ||
    name === 'pr/diff_lines'
  ) {
    const rightVal =
      expr.rhs.kind === 'number'
        ? expr.rhs.value
        : getNumericFact((expr.rhs as { name: string }).name, ctx)
    if (numVal === undefined || rightVal === undefined) return 'unknown'
    return compareNumbers(numVal, expr.op, rightVal) ? 'true' : 'false'
  }

  if (name === 'pr/base' || name === 'pr/repository') {
    const actual = name === 'pr/base' ? ctx.facts.base : ctx.facts.repository
    if (actual === undefined) return 'unknown'
    const matched = rhsToList(expr.rhs).some((pattern) => matchGlob(actual, pattern))
    return (expr.op === '=' ? matched : !matched) ? 'true' : 'false'
  }

  if (name === 'pr/opened_by') {
    if (ctx.facts.openedBy === undefined) return 'unknown'
    const matched = accountMatchesList(ctx.facts.openedBy, rhsToList(expr.rhs), ctx.facts)
    return (expr.op === '=' ? matched : !matched) ? 'true' : 'false'
  }

  if (name === 'pr/approved_by' && expr.rhs.kind === 'string' && expr.rhs.value === 'empty') {
    if (!ctx.facts.approvedBy) return 'unknown'
    const isEmpty = ctx.facts.approvedBy.length === 0
    return (expr.op === '=' ? isEmpty : !isEmpty) ? 'true' : 'false'
  }

  const list =
    name === 'pr/authors'
      ? ctx.facts.authors
      : name === 'pr/approved_by'
        ? ctx.facts.approvedBy
        : ctx.facts.labels
  if (!list) return 'unknown'
  const targets = rhsToList(expr.rhs)
  if (list.length === 0) return expr.op === '=' ? 'false' : 'true'
  const matchItem = (entry: string): boolean =>
    name === 'pr/labels' ? targets.includes(entry) : accountMatchesList(entry, targets, ctx.facts)
  const check = (entry: string): boolean => (expr.op === '=' ? matchItem(entry) : !matchItem(entry))
  return (expr.quantifier === 'ALL' ? list.every(check) : list.some(check)) ? 'true' : 'false'
}
