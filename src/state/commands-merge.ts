import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import type { AppliedRuleResult, EvaluatedSeat } from '../policy/eval-types.js'
import { need, REPOSITORY, TEXT, UsageError, type StateContext } from './context.js'
import { dumps, get, isObject, type Json, type JsonObject } from './json.js'
import { PULL_REF } from './late-review.js'
import { arrayField, expectArray, loadState, parseJson, saveState, StateError } from './store.js'

/** A full commit id: 40 hex digits, or 64 in a SHA-256 repository. */
const HEAD = /^([0-9a-f]{40}|[0-9a-f]{64})$/i

type Rule = Pick<AppliedRuleResult, 'purpose' | 'sourceFile'>
type Seat = Record<keyof Pick<EvaluatedSeat, 'count' | 'from' | 'filledBy'>, Json>

function refuse(message: string): never {
  throw new StateError(`merge-record: ${message}`)
}

async function readObject(file: string, flag: string): Promise<JsonObject> {
  const value = parseJson(await readFile(file, 'utf8'), `--${flag} ${file}`)
  return isObject(value) ? value : refuse(`--${flag} ${file} must hold a JSON object`)
}

/** The distinct rules the check applied to any changed file, in the order it applied them. */
function appliedRules(files: Json[]): Rule[] {
  const rules = new Map<string, Rule>()
  for (const file of files) {
    const applied = isObject(file) && Array.isArray(file.rules) ? file.rules : []
    for (const rule of applied) {
      if (!isObject(rule)) {
        continue
      }
      const { purpose, sourceFile } = rule
      if (typeof purpose === 'string' && typeof sourceFile === 'string') {
        rules.set(dumps([sourceFile, purpose]), { purpose, sourceFile })
      }
    }
  }
  return [...rules.values()]
}

const REAL = 'supervisor policy check <owner>/<repo> <N> --json'

/** Refuse a check that is not of this pull request at this head, read from GitHub. */
function samePull(check: JsonObject, ref: RegExpExecArray, head: string): void {
  const { pull } = check
  if (!isObject(pull)) {
    refuse(`the check names no pull request: record a merge from "${REAL}", not from --input`)
  }
  const wanted = `${ref[1]}/${ref[2]}#${ref[3]}`
  const checked = `${String(pull.repository)}#${String(pull.number)}`
  if (checked.toLowerCase() !== wanted.toLowerCase()) {
    refuse(`the check is of ${checked}, not --pr ${wanted}`)
  }
  if (String(pull.head).toLowerCase() !== head) {
    refuse(`the check is of head ${String(pull.head)}, not --head ${head}`)
  }
}

/** Refuse a check that does not allow the merge; the next step covers each, checked again here. */
function allows(check: JsonObject, nextStep: JsonObject): void {
  const { blockers, readiness, authorOnlyWarnings: warnings } = check
  if (nextStep.action !== 'merge') {
    const reason = typeof nextStep.reason === 'string' ? ` (${nextStep.reason})` : ''
    refuse(`the check's next step is ${dumps(nextStep.action ?? null)}${reason}, not "merge"`)
  }
  if (!Array.isArray(blockers) || blockers.length > 0) {
    refuse(`the check has blockers: ${dumps(blockers ?? null)}`)
  }
  if (!isObject(readiness) || readiness.ready !== true) {
    const action = isObject(readiness) ? readiness.action : undefined
    refuse(
      `pr-shepherd does not say the head is ready to merge (its action is ${dumps(action ?? null)})`,
    )
  }
  if (!Array.isArray(warnings) || warnings.length > 0) {
    refuse('the check has author-only warnings, so nobody but the author filled a seat')
  }
}

/** What the record keeps from a pull check result that allows the merge of this head. */
function fromCheck(check: JsonObject, file: string, ref: RegExpExecArray, head: string) {
  const { files, seats, nextStep } = check
  if (!isObject(nextStep) || !Array.isArray(files) || !Array.isArray(seats)) {
    refuse(`--check ${file} is not the JSON that "supervisor policy check --json" prints`)
  }
  samePull(check, ref, head)
  allows(check, nextStep)
  const rules = appliedRules(files)
  if (rules.length === 0) {
    refuse('the check names no rule that allowed the merge')
  }
  const classifiers = check.classifiers ?? {}
  if (!isObject(classifiers)) {
    refuse(`--check ${file}: classifiers must be object`)
  }
  const kept: Seat[] = seats.filter(isObject).map((seat) => ({
    count: seat.count ?? null,
    from: seat.from ?? [],
    filledBy: seat.filledBy ?? [],
  }))
  const { action } = check.readiness as JsonObject
  const readiness = { ready: true, action: action ?? null }
  return { rules, classifiers, seats: kept, readiness }
}

/**
 * Record one autonomous merge before it is made: the pull request, the head, the rules that allowed
 * it, the classifier results, the seats and who filled them, pr-shepherd's readiness answer, the review,
 * and the always-human check.
 */
export async function mergeRecord(args: string[], ctx: StateContext): Promise<void> {
  const flags = ['pr', 'head', 'check', 'review', 'always-human'] as const
  const options = Object.fromEntries(flags.map((flag) => [flag, TEXT]))
  const { values } = parseArgs({ args, options })
  const [pr, given, check, review, alwaysHuman] = flags.map((flag) => {
    const value = need(values[flag] as string | undefined, flag).trim()
    if (value === '') {
      throw new UsageError(`--${flag} must not be empty`)
    }
    return value
  }) as [string, string, string, string, string]
  const ref = PULL_REF.exec(pr)
  if (!ref) {
    refuse(`--pr '${pr}' must look like owner/repo#N`)
  }
  if (!HEAD.test(given)) {
    refuse(`--head '${given}' must be a full commit id`)
  }
  const head = given.toLowerCase()
  const allowed = fromCheck(await readObject(check, 'check'), check, ref, head)
  const record: JsonObject = {
    pr,
    head,
    at: ctx.now(),
    rules: allowed.rules,
    classifiers: allowed.classifiers,
    seats: allowed.seats,
    readiness: allowed.readiness,
    review,
    alwaysHuman,
  }
  const state = await loadState(ctx.dir)
  arrayField(state, 'mergeRecords').push(record)
  await saveState(ctx.dir, state)
  ctx.print(record)
}

function hasRule(record: JsonObject, text: string): boolean {
  const rules = Array.isArray(record.rules) ? record.rules : []
  return rules.some(
    (rule) =>
      isObject(rule) &&
      typeof rule.purpose === 'string' &&
      rule.purpose.toLowerCase().includes(text.toLowerCase()),
  )
}

/** Print the merge records, one JSON line each, for one repository or one rule purpose. */
export async function mergeRecords(args: string[], ctx: StateContext): Promise<number> {
  const { values } = parseArgs({ args, options: { repo: TEXT, rule: TEXT } })
  const { repo, rule } = values
  if (repo !== undefined && !REPOSITORY.test(repo)) {
    throw new UsageError(`--repo '${repo}' must look like owner/repo`)
  }
  const prefix = `${repo}#`.toLowerCase()
  const state = await loadState(ctx.dir)
  for (const record of expectArray(get(state, 'mergeRecords') ?? [], 'mergeRecords')) {
    const pr = isObject(record) && typeof record.pr === 'string' ? record.pr : ''
    const inRepo = repo === undefined || pr.toLowerCase().startsWith(prefix)
    const byRule = rule === undefined || (isObject(record) && hasRule(record, rule))
    if (inRepo && byRule) {
      ctx.write(`${dumps(record)}\n`)
    }
  }
  return 0
}
