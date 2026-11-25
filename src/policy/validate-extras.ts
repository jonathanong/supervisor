import { extractClassifierCalls } from './condition-validate.js'
import { isPlainObject } from './locals.js'
import {
  POLICY_LIMITS,
  type FindingsSpec,
  type PolicyValidationError,
  type ResolutionSet,
  type ResolutionTarget,
  type ReuseSpec,
  type ReuseValue,
} from './types.js'
import { checkAllowedKeys, parseConditionField, parsePeopleList } from './validate-parts.js'

const RES_SET_KEYS = new Set(['if', 'from'])

export function parseReuse(
  raw: unknown,
  locals: Record<string, unknown>,
  supervisorPolicy: boolean,
  path: string,
  file: string,
  errors: PolicyValidationError[],
): ReuseSpec | undefined {
  const parseVal = (val: unknown, p: string, ownerKey?: string): ReuseValue | undefined => {
    if (val === 'unset') return 'unset'
    if (typeof val === 'boolean') return val
    const expr = parseConditionField(
      val,
      locals,
      { allowReuseOnly: true, supervisorPolicy },
      p,
      file,
      errors,
    )
    if (expr && ownerKey && extractClassifierCalls(expr).some((c) => c.name === ownerKey)) {
      errors.push({
        file,
        path: p,
        message: `Classifier '${ownerKey}' cannot reference itself in reuse`,
      })
    }
    return expr
  }
  if (!isPlainObject(raw)) return parseVal(raw, path)
  const out: Record<string, ReuseValue> = {}
  for (const [key, val] of Object.entries(raw)) {
    if (key === 'claude' || key === 'claude/diff' || key.includes('(')) {
      errors.push({ file, path: `${path}.${key}`, message: `Invalid reuse key '${key}'` })
      continue
    }
    const parsed = parseVal(val, `${path}.${key}`, key === 'seats' ? undefined : key)
    if (parsed !== undefined) out[key] = parsed
  }
  return out
}

export function parseFindings(
  raw: unknown,
  locals: Record<string, unknown>,
  supervisorPolicy: boolean,
  path: string,
  file: string,
  errors: PolicyValidationError[],
): FindingsSpec | undefined {
  if (!isPlainObject(raw)) {
    errors.push({ file, path, message: 'findings must be an object with resolution' })
    return undefined
  }
  checkAllowedKeys(raw, new Set(['resolution']), path, file, errors)
  if (raw.resolution === undefined) {
    errors.push({ file, path: `${path}.resolution`, message: 'findings.resolution is required' })
    return undefined
  }
  if (raw.resolution === 'unset') return { resolution: 'unset' }

  const parseTarget = (val: unknown, p: string): ResolutionTarget => {
    if (Array.isArray(val) && val.length > 0 && isPlainObject(val[0])) {
      if (val.length > POLICY_LIMITS.maxResolutionSets) {
        errors.push({
          file,
          path: p,
          message: `resolution exceeds ${POLICY_LIMITS.maxResolutionSets} sets`,
        })
      }
      const sets: ResolutionSet[] = []
      for (let i = 0; i < val.length; i += 1) {
        const sp = `${p}[${i}]`
        const item = val[i]
        if (!isPlainObject(item)) {
          errors.push({
            file,
            path: sp,
            message: 'Cannot mix resolution sets with account strings',
          })
          continue
        }
        checkAllowedKeys(item, RES_SET_KEYS, sp, file, errors)
        if (item.if === undefined && i !== val.length - 1) {
          errors.push({
            file,
            path: sp,
            message: 'Unconditional resolution set is only allowed last',
          })
        }
        const cond =
          item.if !== undefined
            ? parseConditionField(
                item.if,
                locals,
                { allowFindingSeverity: true, supervisorPolicy },
                `${sp}.if`,
                file,
                errors,
              )
            : undefined
        const from = parsePeopleList(
          item.from,
          locals,
          { allowNobody: true, allowApprovedBy: true },
          `${sp}.from`,
          file,
          errors,
        )
        sets.push({ ...(cond ? { if: cond } : {}), from })
      }
      return sets
    }
    return parsePeopleList(
      val,
      locals,
      { allowNobody: true, allowApprovedBy: true },
      p,
      file,
      errors,
    )
  }

  if (isPlainObject(raw.resolution)) {
    const entries = Object.entries(raw.resolution)
    if (entries.length === 0) {
      errors.push({
        file,
        path: `${path}.resolution`,
        message: 'findings.resolution map must not be empty',
      })
      return undefined
    }
    const map: Record<string, ResolutionTarget> = {}
    for (const [key, val] of entries) {
      if (
        key === 'claude/diff' ||
        key.includes('(') ||
        (!key.startsWith('repo/') && key !== 'claude/code_review')
      ) {
        errors.push({
          file,
          path: `${path}.resolution.${key}`,
          message: `Invalid findings classifier key '${key}'`,
        })
        continue
      }
      map[key] = parseTarget(val, `${path}.resolution.${key}`)
    }
    return { resolution: map }
  }
  return { resolution: parseTarget(raw.resolution, `${path}.resolution`) }
}
