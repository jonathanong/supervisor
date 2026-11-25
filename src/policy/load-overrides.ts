import { parseClassifierRef } from './condition-parser.js'
import { expandUseMaps, isPlainObject, resolveLocalValue } from './locals.js'
import {
  POLICY_LIMITS,
  type ClassifierCall,
  type PolicyOverride,
  type PolicyValidationError,
  type Verdict,
  type VerdictPatch,
} from './types.js'
import { parseFindings, parseReuse } from './validate-extras.js'
import { checkAllowedKeys, parseConditionField } from './validate-parts.js'
import { parseVerdict } from './validate-verdict.js'

const OVERRIDE_KEYS = new Set(['if', 'verdict', 'reuse', 'findings', 'purpose', 'use'])
const OVERRIDE_USE_KEYS = new Set(['verdict', 'findings'])

export function parseAdvisory(
  raw: unknown,
  path: string,
  file: string,
  errors: PolicyValidationError[],
): ClassifierCall[] {
  if (!Array.isArray(raw)) {
    errors.push({ file, path, message: 'advisory must be a list of classifier names or calls' })
    return []
  }
  const calls: ClassifierCall[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i]
    if (typeof item !== 'string') {
      errors.push({ file, path: `${path}[${i}]`, message: 'advisory item must be a string' })
      continue
    }
    try {
      const call = parseClassifierRef(item)
      if (call.output) {
        errors.push({
          file,
          path: `${path}[${i}]`,
          message: 'advisory classifier must not include an output',
        })
      } else {
        calls.push(call)
      }
    } catch (err) {
      errors.push({ file, path: `${path}[${i}]`, message: (err as Error).message })
    }
  }
  return calls
}

export function parseOverrides(
  raw: unknown,
  ruleVerdict: Verdict | undefined,
  locals: Record<string, unknown>,
  supervisorPolicy: boolean,
  path: string,
  file: string,
  errors: PolicyValidationError[],
): PolicyOverride[] {
  const resolved = resolveLocalValue(raw, locals, path, file, errors)
  if (!Array.isArray(resolved)) {
    errors.push({ file, path, message: 'override must be a list' })
    return []
  }
  if (resolved.length > POLICY_LIMITS.maxOverridesPerRule) {
    errors.push({
      file,
      path,
      message: `override exceeds maximum of ${POLICY_LIMITS.maxOverridesPerRule}`,
    })
  }
  const out: PolicyOverride[] = []
  for (let i = 0; i < resolved.length; i += 1) {
    const op = `${path}[${i}]`
    const item = resolved[i]
    if (!isPlainObject(item)) {
      errors.push({ file, path: op, message: 'override entry must be an object' })
      continue
    }
    checkAllowedKeys(item, OVERRIDE_KEYS, op, file, errors)
    const exp = expandUseMaps(item, locals, OVERRIDE_USE_KEYS, op, file, errors)
    if (exp.if === undefined) {
      errors.push({ file, path: `${op}.if`, message: 'override.if is required' })
      continue
    }
    const cond = parseConditionField(exp.if, locals, { supervisorPolicy }, `${op}.if`, file, errors)
    const verdict =
      exp.verdict !== undefined
        ? (parseVerdict(exp.verdict, locals, true, `${op}.verdict`, file, errors) as
            | VerdictPatch
            | undefined)
        : undefined
    const reuse =
      exp.reuse !== undefined
        ? parseReuse(exp.reuse, locals, supervisorPolicy, `${op}.reuse`, file, errors)
        : undefined
    const findings =
      exp.findings !== undefined
        ? parseFindings(exp.findings, locals, supervisorPolicy, `${op}.findings`, file, errors)
        : undefined
    if (!verdict && reuse === undefined && !findings) {
      errors.push({
        file,
        path: op,
        message: 'override must write at least one of verdict, reuse, or findings',
      })
    }
    if (
      ruleVerdict?.claude === 'blocks' &&
      verdict?.claude &&
      verdict.claude !== 'blocks' &&
      !verdict.seats
    ) {
      errors.push({
        file,
        path: `${op}.verdict.seats`,
        message: 'Override opening a blocks rule must write seats',
      })
    }
    if (cond) {
      out.push({
        if: cond,
        ...(typeof exp.purpose === 'string' ? { purpose: exp.purpose } : {}),
        ...(verdict ? { verdict } : {}),
        ...(reuse !== undefined ? { reuse } : {}),
        ...(findings ? { findings } : {}),
      })
    }
  }
  return out
}
