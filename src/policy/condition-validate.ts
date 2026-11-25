import type {
  ClassifierCall,
  ComparisonOp,
  ConditionExpr,
  ConditionLhs,
  ConditionRhs,
  Quantifier,
} from './types.js'

export interface ConditionParseOptions {
  allowReuseOnly?: boolean
  allowFindingSeverity?: boolean
  supervisorPolicy?: boolean
}

export const NUMERIC_FACTS = new Set([
  'pr/files_changed',
  'pr/files_added',
  'pr/files_removed',
  'pr/diff_lines',
  'rule/files_changed',
  'rule/files_added',
  'rule/files_removed',
])

const LIST_FACTS = new Set(['pr/authors', 'pr/approved_by'])
const SCALAR_FACTS = new Set(['pr/opened_by', 'pr/base'])
const SUPERVISOR_LIST_FACTS = new Set(['pr/labels'])
const SUPERVISOR_SCALAR_FACTS = new Set(['pr/repository'])
const REVIEW_LEVELS = new Set(['quick', 'standard', 'deep'])
const SEVERITY_VALUES = new Set(['none', 'minimal', 'low', 'medium', 'high', 'critical'])
const ORDER_OPS = new Set<ComparisonOp>(['<', '<=', '>', '>='])

function validateFact(
  quantifier: Quantifier | undefined,
  name: string,
  op: ComparisonOp,
  rhs: ConditionRhs,
  opts: ConditionParseOptions,
): void {
  if (SUPERVISOR_LIST_FACTS.has(name) || SUPERVISOR_SCALAR_FACTS.has(name)) {
    if (!opts.supervisorPolicy) {
      throw new Error(`Fact '${name}' is only allowed in supervisor policies`)
    }
  }
  if (name === 'finding/severity') {
    if (!opts.allowFindingSeverity) {
      throw new Error("Fact 'finding/severity' is only allowed in findings.resolution sets")
    }
    if (quantifier) throw new Error("Quantifier not allowed on 'finding/severity'")
    if (rhs.kind !== 'string' || !SEVERITY_VALUES.has(rhs.value)) {
      throw new Error('finding/severity must be compared to a valid severity level')
    }
    if ((op === '<' && rhs.value === 'minimal') || (op === '>' && rhs.value === 'critical')) {
      throw new Error(`Impossible finding/severity comparison: ${op} ${rhs.value}`)
    }
    return
  }
  if (NUMERIC_FACTS.has(name)) {
    if (quantifier) throw new Error(`Quantifier not allowed on numeric fact '${name}'`)
    if (rhs.kind !== 'number' && rhs.kind !== 'fact') {
      throw new Error(`Numeric fact '${name}' must be compared to a number or count fact`)
    }
    return
  }
  if (LIST_FACTS.has(name) || SUPERVISOR_LIST_FACTS.has(name)) {
    if (ORDER_OPS.has(op)) throw new Error(`Operator '${op}' is not valid for '${name}'`)
    const isEmptyCheck = name === 'pr/approved_by' && rhs.kind === 'string' && rhs.value === 'empty'
    if (isEmptyCheck) {
      if (quantifier) throw new Error('pr/approved_by = empty must not use ANY or ALL')
      return
    }
    // TODO(spec): confirm whether supervisor-only `pr/labels` also accepts a bare `pr/labels = 'foo'` form without ANY/ALL.
    if (!quantifier) throw new Error(`Fact '${name}' requires ANY or ALL quantifier`)
    return
  }
  if (SCALAR_FACTS.has(name) || SUPERVISOR_SCALAR_FACTS.has(name)) {
    if (quantifier) throw new Error(`Quantifier not allowed on '${name}'`)
    if (ORDER_OPS.has(op)) throw new Error(`Operator '${op}' is not valid for '${name}'`)
    return
  }
  throw new Error(`Unknown fact '${name}'`)
}

function validateClassifier(
  call: ClassifierCall,
  op: ComparisonOp,
  rhs: ConditionRhs,
  opts: ConditionParseOptions,
): void {
  const isErrStatus = rhs.kind === 'string' && (rhs.value === 'error' || rhs.value === 'incomplete')
  if (isErrStatus) {
    if (op !== '=') throw new Error(`Status '${rhs.value}' only supports '='`)
    if (opts.allowReuseOnly) {
      throw new Error(`Status '${rhs.value}' is not allowed in reuse conditions`)
    }
    return
  }
  if (call.name === 'claude/diff') {
    if (!opts.allowReuseOnly) {
      throw new Error("'claude/diff' is only allowed in reuse conditions")
    }
    if (Object.keys(call.inputs).length > 0 || call.output) {
      throw new Error("'claude/diff' takes no inputs or outputs")
    }
    return
  }
  if (call.name === 'claude/code_review') {
    for (const [k, v] of Object.entries(call.inputs)) {
      if (k !== 'level' || typeof v !== 'string' || !REVIEW_LEVELS.has(v)) {
        throw new Error(`Invalid claude/code_review input '${k}=${String(v)}'`)
      }
    }
    if (call.output && call.output !== 'severity') {
      throw new Error(`Unknown claude/code_review output '${call.output}'`)
    }
    if (!call.output && ORDER_OPS.has(op)) {
      throw new Error("Operator not allowed on bare 'claude/code_review' answer")
    }
  }
  // TODO(spec): validate repo/<name>.<output> operators against def.yml output types (criteria vs ordinal vs numeric) when classifier definitions are loaded.
}

export function validateComparison(
  quantifier: Quantifier | undefined,
  lhs: ConditionLhs,
  op: ComparisonOp,
  rhs: ConditionRhs,
  opts: ConditionParseOptions,
): void {
  if (lhs.kind === 'fact') {
    validateFact(quantifier, lhs.name, op, rhs, opts)
    return
  }
  if (quantifier) {
    throw new Error(`Quantifier '${quantifier}' is only allowed before list facts`)
  }
  validateClassifier(lhs.call, op, rhs, opts)
}

export function extractClassifierCalls(expr: ConditionExpr): ClassifierCall[] {
  if (expr.kind === 'literal') return []
  if (expr.kind === 'logical') return expr.items.flatMap(extractClassifierCalls)
  return expr.lhs.kind === 'classifier' ? [expr.lhs.call] : []
}
