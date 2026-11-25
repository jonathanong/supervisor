import { parseCondition } from './condition-parser.js'
import { expandConditionLocals, expandStringListWithLocals, resolveLocalValue } from './locals.js'
import { POLICY_LIMITS, type ConditionExpr, type PolicyValidationError } from './types.js'

export function parseEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
  path: string,
  file: string,
  errors: PolicyValidationError[],
): T {
  if (raw === undefined) return fallback
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
    errors.push({ file, path, message: `Expected one of: ${allowed.join(', ')}` })
    return fallback
  }
  return raw as T
}

export function checkAllowedKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  file: string,
  errors: PolicyValidationError[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push({ file, path: path ? `${path}.${key}` : key, message: `Unknown key '${key}'` })
    }
  }
}

export function parseConditionField(
  raw: unknown,
  locals: Record<string, unknown>,
  opts: { allowReuseOnly?: boolean; allowFindingSeverity?: boolean; supervisorPolicy?: boolean },
  path: string,
  file: string,
  errors: PolicyValidationError[],
): ConditionExpr | undefined {
  const resolved = resolveLocalValue(raw, locals, path, file, errors)
  if (typeof resolved === 'boolean') return { kind: 'literal', value: resolved }
  if (typeof resolved !== 'string') {
    errors.push({ file, path, message: 'Condition must be a boolean or string' })
    return undefined
  }
  const expanded = expandConditionLocals(resolved, locals, path, file, errors)
  try {
    return parseCondition(expanded, opts)
  } catch (err) {
    errors.push({ file, path, message: (err as Error).message })
    return undefined
  }
}

export function isTeamItem(item: string): boolean {
  const body = item.startsWith('!') ? item.slice(1) : item
  return body.includes('/') && !body.startsWith('pr/')
}

export function parsePeopleList(
  raw: unknown,
  locals: Record<string, unknown>,
  opts: { allowNobody?: boolean; allowApprovedBy?: boolean },
  path: string,
  file: string,
  errors: PolicyValidationError[],
): string[] {
  const items = expandStringListWithLocals(raw, locals, path, file, errors)
  if (items.length === 0) {
    errors.push({ file, path, message: 'People list must not be empty' })
    return []
  }
  if (items.length > POLICY_LIMITS.maxListEntries) {
    errors.push({
      file,
      path,
      message: `People list exceeds ${POLICY_LIMITS.maxListEntries} entries`,
    })
  }
  let positiveCount = 0
  let teamCount = 0
  for (const item of items) {
    if (item.includes('<') || item.includes('>')) {
      errors.push({ file, path, message: `Placeholder '${item}' is not allowed` })
    }
    const isNeg = item.startsWith('!')
    const body = isNeg ? item.slice(1) : item
    if (isNeg && (body.length === 0 || /^\s/.test(body))) {
      errors.push({ file, path, message: `Invalid negated item '${item}'` })
    }
    if (body === 'nobody' && !opts.allowNobody) {
      errors.push({ file, path, message: "'nobody' is only allowed in findings.resolution" })
    }
    if (body === 'pr/approved_by' && !opts.allowApprovedBy) {
      errors.push({ file, path, message: "'pr/approved_by' is not allowed in seats" })
    }
    if (isTeamItem(item)) teamCount += 1
    if (!isNeg) positiveCount += 1
  }
  if (positiveCount === 0) {
    errors.push({ file, path, message: 'People list must include at least one non-negated item' })
  }
  if (teamCount > POLICY_LIMITS.maxTeamsPerList) {
    errors.push({
      file,
      path,
      message: `People list exceeds maximum of ${POLICY_LIMITS.maxTeamsPerList} teams`,
    })
  }
  return items
}
