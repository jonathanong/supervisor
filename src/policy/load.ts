import { readFile } from 'node:fs/promises'
import { parseDocument } from 'yaml'
import { extractClassifierCalls } from './condition-validate.js'
import { parseRule } from './load-rule.js'
import { isPlainObject } from './locals.js'
import {
  POLICY_LIMITS,
  PolicyLoadError,
  type LoadPolicyOptions,
  type NestedMode,
  type PolicyFile,
  type PolicyMode,
  type PolicyRule,
  type PolicyValidationError,
  type RunMode,
} from './types.js'
import { checkAllowedKeys, parseEnum } from './validate-parts.js'

const FILE_KEYS = new Set(['version', 'mode', 'nested', 'run', 'locals', 'rules'])

export function parsePolicySource(source: string, opts: LoadPolicyOptions = {}): PolicyFile {
  const file = opts.filePath ?? '<memory>'
  const dir = opts.dir ?? ''
  const supervisorPolicy = opts.supervisorPolicy ?? false
  const errors: PolicyValidationError[] = []

  if (Buffer.byteLength(source, 'utf8') > POLICY_LIMITS.maxFileBytes) {
    throw new PolicyLoadError([
      { file, path: '$', message: `Policy file exceeds ${POLICY_LIMITS.maxFileBytes} bytes` },
    ])
  }
  const doc = parseDocument(source, { uniqueKeys: true })
  if (doc.errors.length > 0) {
    throw new PolicyLoadError(doc.errors.map((err) => ({ file, path: '$', message: err.message })))
  }
  const root = doc.toJS()
  if (!isPlainObject(root)) {
    throw new PolicyLoadError([
      { file, path: '$', message: 'Policy file root must be a YAML mapping' },
    ])
  }
  checkAllowedKeys(root, FILE_KEYS, '', file, errors)
  if (root.version !== 1) {
    errors.push({ file, path: 'version', message: 'version must be the integer 1' })
  }
  const fileMode = parseEnum<PolicyMode>(
    root.mode,
    ['enforce', 'observe'],
    'enforce',
    'mode',
    file,
    errors,
  )
  const fileNested = parseEnum<NestedMode>(
    root.nested,
    ['overwrite', 'inherit'],
    'overwrite',
    'nested',
    file,
    errors,
  )
  const fileRun = parseEnum<RunMode>(
    root.run,
    ['sequential', 'parallel'],
    'sequential',
    'run',
    file,
    errors,
  )

  const ownLocals: Record<string, unknown> = {}
  if (root.locals !== undefined) {
    if (!isPlainObject(root.locals)) {
      errors.push({ file, path: 'locals', message: 'locals must be a mapping' })
    } else {
      const entries = Object.entries(root.locals)
      if (entries.length > POLICY_LIMITS.maxLocalsPerFile) {
        errors.push({
          file,
          path: 'locals',
          message: `locals exceeds maximum of ${POLICY_LIMITS.maxLocalsPerFile}`,
        })
      }
      for (const [k, v] of entries) ownLocals[k] = v
    }
  }
  const locals = { ...opts.inheritedLocals, ...ownLocals }

  if (!Array.isArray(root.rules)) {
    errors.push({ file, path: 'rules', message: 'rules is required and must be a list' })
    throw new PolicyLoadError(errors)
  }
  if (root.rules.length > POLICY_LIMITS.maxRulesPerFile) {
    errors.push({
      file,
      path: 'rules',
      message: `rules exceeds maximum of ${POLICY_LIMITS.maxRulesPerFile}`,
    })
  }

  const rules: PolicyRule[] = []
  let totalOverrides = 0
  const repoClassifiers = new Set<string>()
  let repoRuns = 0
  const ruleEnv = { file, dir, fileMode, fileNested, fileRun, locals, supervisorPolicy }

  for (let i = 0; i < root.rules.length; i += 1) {
    const rule = parseRule(root.rules[i], `rules[${i}]`, ruleEnv, errors)
    if (!rule) continue
    totalOverrides += rule.override.length
    const calls = [
      ...extractClassifierCalls(rule.if),
      ...rule.override.flatMap((o) => extractClassifierCalls(o.if)),
      ...rule.advisory,
    ]
    for (const call of calls) {
      if (call.name.startsWith('repo/')) {
        repoClassifiers.add(call.name)
        repoRuns += 1
      }
    }
    rules.push(rule)
  }

  if (totalOverrides > POLICY_LIMITS.maxOverridesPerFile) {
    errors.push({
      file,
      path: 'rules',
      message: `Total overrides (${totalOverrides}) exceeds ${POLICY_LIMITS.maxOverridesPerFile}`,
    })
  }
  if (repoClassifiers.size > POLICY_LIMITS.maxRepoClassifiersPerFile) {
    errors.push({
      file,
      path: 'rules',
      message: `File names more than ${POLICY_LIMITS.maxRepoClassifiersPerFile} repo classifiers`,
    })
  }
  if (repoRuns > POLICY_LIMITS.maxRepoRunsPerFile) {
    errors.push({
      file,
      path: 'rules',
      message: `File exceeds ${POLICY_LIMITS.maxRepoRunsPerFile} repo classifier runs`,
    })
  }
  if (errors.length > 0) throw new PolicyLoadError(errors)

  const verdictRules = rules.filter((r) => r.verdict !== undefined)
  const effectiveObserve =
    fileMode === 'observe' ||
    (verdictRules.length > 0 && verdictRules.every((r) => r.mode === 'observe'))
  return {
    path: file,
    dir,
    version: 1,
    mode: fileMode,
    nested: fileNested,
    run: fileRun,
    locals,
    rules,
    effectiveObserve,
  }
}

export async function loadPolicyFile(
  filePath: string,
  opts: LoadPolicyOptions = {},
): Promise<PolicyFile> {
  const source = await readFile(filePath, 'utf8')
  return parsePolicySource(source, { ...opts, filePath: opts.filePath ?? filePath })
}
