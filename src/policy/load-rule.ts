import { validatePathPattern } from './glob.js'
import { parseAdvisory, parseOverrides } from './load-overrides.js'
import { expandStringListWithLocals, expandUseMaps, isPlainObject } from './locals.js'
import {
  POLICY_LIMITS,
  type NestedMode,
  type PolicyMode,
  type PolicyRule,
  type PolicyValidationError,
  type RunMode,
  type Verdict,
} from './types.js'
import { parseFindings, parseReuse } from './validate-extras.js'
import { checkAllowedKeys, parseConditionField, parseEnum } from './validate-parts.js'
import { parseVerdict } from './validate-verdict.js'

const RULE_KEYS = new Set([
  'purpose',
  'paths',
  'verdict',
  'if',
  'override',
  'advisory',
  'reuse',
  'use',
  'mode',
  'nested',
  'run',
  'findings',
])
const RULE_USE_KEYS = new Set([
  'verdict',
  'override',
  'if',
  'paths',
  'reuse',
  'advisory',
  'findings',
])

export interface RuleParseEnv {
  file: string
  dir: string
  fileMode: PolicyMode
  fileNested: NestedMode
  fileRun: RunMode
  locals: Record<string, unknown>
  supervisorPolicy: boolean
}

export function parseRule(
  rawRule: unknown,
  rp: string,
  env: RuleParseEnv,
  errors: PolicyValidationError[],
): PolicyRule | undefined {
  const err = (path: string, message: string) => errors.push({ file: env.file, path, message })
  if (!isPlainObject(rawRule)) {
    err(rp, 'Rule must be an object')
    return undefined
  }
  checkAllowedKeys(rawRule, RULE_KEYS, rp, env.file, errors)
  const r = expandUseMaps(rawRule, env.locals, RULE_USE_KEYS, rp, env.file, errors)

  const purpose = r.purpose
  if (typeof purpose !== 'string' || purpose.length === 0 || purpose.includes('\n')) {
    err(`${rp}.purpose`, 'purpose must be a single non-empty line')
  } else if (purpose.length > POLICY_LIMITS.maxPurposeLength) {
    err(`${rp}.purpose`, `purpose exceeds ${POLICY_LIMITS.maxPurposeLength} characters`)
  }

  const paths = expandStringListWithLocals(
    r.paths,
    env.locals,
    `${rp}.paths`,
    env.file,
    errors,
    true,
  )
  let positive = 0
  for (let i = 0; i < paths.length; i += 1) {
    const pErr = validatePathPattern(paths[i]!)
    if (pErr) err(`${rp}.paths[${i}]`, pErr)
    if (!paths[i]!.startsWith('!')) positive += 1
  }
  if (positive === 0) err(`${rp}.paths`, 'paths must include at least one non-negated pattern')
  if (positive > POLICY_LIMITS.maxPatternsPerRule) {
    err(`${rp}.paths`, `paths exceeds ${POLICY_LIMITS.maxPatternsPerRule} patterns`)
  }

  const { file, locals, supervisorPolicy } = env
  const mode =
    env.fileMode === 'observe'
      ? 'observe'
      : parseEnum<PolicyMode>(
          r.mode,
          ['enforce', 'observe'],
          env.fileMode,
          `${rp}.mode`,
          file,
          errors,
        )
  const nested = parseEnum<NestedMode>(
    r.nested,
    ['overwrite', 'inherit'],
    env.fileNested,
    `${rp}.nested`,
    file,
    errors,
  )
  const run = parseEnum<RunMode>(
    r.run,
    ['sequential', 'parallel'],
    env.fileRun,
    `${rp}.run`,
    file,
    errors,
  )
  const ruleIf =
    r.if !== undefined
      ? (parseConditionField(r.if, locals, { supervisorPolicy }, `${rp}.if`, file, errors) ?? {
          kind: 'literal',
          value: true,
        })
      : { kind: 'literal' as const, value: true }
  const verdict =
    r.verdict !== undefined
      ? (parseVerdict(r.verdict, locals, false, `${rp}.verdict`, file, errors) as
          | Verdict
          | undefined)
      : undefined
  const advisory =
    r.advisory !== undefined ? parseAdvisory(r.advisory, `${rp}.advisory`, file, errors) : []
  const reuse =
    r.reuse !== undefined
      ? parseReuse(r.reuse, locals, supervisorPolicy, `${rp}.reuse`, file, errors)
      : undefined
  const findings =
    r.findings !== undefined
      ? parseFindings(r.findings, locals, supervisorPolicy, `${rp}.findings`, file, errors)
      : undefined
  const overrides =
    r.override !== undefined
      ? parseOverrides(
          r.override,
          verdict,
          locals,
          supervisorPolicy,
          `${rp}.override`,
          file,
          errors,
        )
      : []

  if (!verdict) {
    const hasReuseClassifier = isPlainObject(reuse) && Object.keys(reuse).some((k) => k !== 'seats')
    const hasSeatsReuse = isPlainObject(reuse) && 'seats' in reuse
    if (
      (!findings && advisory.length === 0 && !hasReuseClassifier) ||
      overrides.length > 0 ||
      hasSeatsReuse
    ) {
      err(
        `${rp}.verdict`,
        'Rule without verdict requires findings, non-empty advisory, or classifier reuse, and no override or seats reuse',
      )
    }
  }

  return {
    purpose: typeof purpose === 'string' ? purpose : '',
    paths,
    mode,
    nested,
    run,
    if: ruleIf,
    ...(verdict ? { verdict } : {}),
    override: overrides,
    advisory,
    ...(reuse !== undefined ? { reuse } : {}),
    ...(findings ? { findings } : {}),
    sourceFile: file,
    baseDir: env.dir,
  }
}
