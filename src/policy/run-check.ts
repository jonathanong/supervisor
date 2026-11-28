import { requiredAlwaysHumanFromConfig, resolvePolicyFromConfig } from '../config/policy.js'
import { isObject } from '../state/json.js'
import type { RunProcess } from '../state/process.js'
import type { AlwaysHumanRequirement } from './always-human.js'
import { discoverPolicies } from './discover.js'
import { FactsError, PULL_NUMBER, REPOSITORY } from './facts-gh.js'
import type { ShepherdStatus } from './facts-readiness.js'
import { teamsNamed } from './facts-teams.js'
import { collectPullFacts, type PullFacts } from './facts.js'
import { loadLayeredPolicies } from './layers.js'
import { checkPull, type PullCheckResult } from './pull-check.js'
import type { ClassifierResult, PolicyFile } from './types.js'

export interface ClassifiersInput {
  results: Record<string, ClassifierResult>
  /** The head the results were collected for, when `classify-collect` wrote the file. */
  pull?: PullFacts['pull']
}

export interface PullPolicySource {
  dir: string
  repoDir?: string
  supervisorPolicy?: boolean
  requiredAlwaysHuman?: readonly AlwaysHumanRequirement[]
}

export interface PullCheckRequest extends PullPolicySource {
  repository: string
  pr: number
  classifiers?: ClassifiersInput
}

export interface PullCheckDeps {
  env: Record<string, string | undefined>
  cwd: string
  runProcess: RunProcess
  shepherdStatus: ShepherdStatus
}

function isScalar(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number'
}

export function parseClassifiersData(raw: unknown): ClassifiersInput {
  if (!isObject(raw) || !Object.values(raw).every(isObject)) {
    throw new FactsError('Classifiers JSON must be an object of classifier results')
  }
  const { pull, ...results } = raw
  for (const [key, entry] of Object.entries(results) as Array<[string, Record<string, unknown>]>) {
    if (entry.value !== undefined && !isScalar(entry.value)) {
      throw new FactsError(`Classifier '${key}' value must be a string or number`)
    }
    if (
      entry.outputs !== undefined &&
      (!isObject(entry.outputs) || !Object.values(entry.outputs).every(isScalar))
    ) {
      throw new FactsError(`Classifier '${key}' outputs must map names to strings or numbers`)
    }
  }
  return {
    results: results as unknown as Record<string, ClassifierResult>,
    ...(pull ? { pull: pull as unknown as PullFacts['pull'] } : {}),
  }
}

/** Results collected for one head say nothing about another pull request or a later head. */
export function sameHead(bound: PullFacts['pull'], read: PullFacts['pull']): void {
  const same =
    bound.repository === read.repository && bound.number === read.number && bound.head === read.head
  if (same) return
  throw new FactsError(
    `The classifier results are for ${bound.repository}#${bound.number} at ${bound.head}, ` +
      `not ${read.repository}#${read.number} at ${read.head}: run the classifiers again`,
  )
}

/** Loads policies for a CLI or MCP check. */
export async function loadPolicySet(
  source: PullPolicySource,
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<PolicyFile[]> {
  if (!source.repoDir && !source.supervisorPolicy) return await discoverPolicies(source.dir)
  const requiredAlwaysHuman =
    source.requiredAlwaysHuman ?? (await requiredAlwaysHumanFromConfig(env, cwd))
  return source.repoDir
    ? await loadLayeredPolicies(source.dir, source.repoDir, { requiredAlwaysHuman })
    : await discoverPolicies(source.dir, { supervisorPolicy: true, requiredAlwaysHuman })
}

export function assertPullTarget(repository: string, pr: number): void {
  if (!REPOSITORY.test(repository)) {
    throw new FactsError(`'${repository}' must look like <owner>/<repo>.`)
  }
  if (!Number.isSafeInteger(pr) || !PULL_NUMBER.test(String(pr))) {
    throw new FactsError(`'${pr}' must be a pull request number.`)
  }
}

export async function collectPullCheckFacts(
  request: PullCheckRequest,
  deps: PullCheckDeps,
): Promise<{ policies: PolicyFile[]; facts: PullFacts }> {
  assertPullTarget(request.repository, request.pr)
  const policies = await loadPolicySet(request, deps.env, deps.cwd)
  const facts = await collectPullFacts(deps.runProcess, request.repository, request.pr, {
    teams: teamsNamed(policies),
    status: deps.shepherdStatus,
    cwd: request.repoDir ?? deps.cwd,
    ...(request.classifiers ? { classifiers: request.classifiers.results } : {}),
  })
  if (request.classifiers?.pull) sameHead(request.classifiers.pull, facts.pull)
  return { policies, facts }
}

export async function runPullCheck(
  request: PullCheckRequest,
  deps: PullCheckDeps,
): Promise<PullCheckResult> {
  const { policies, facts } = await collectPullCheckFacts(request, deps)
  return checkPull(policies, facts)
}

/** Runs a policy check using only the operator's supervisor configuration. */
export async function runConfiguredPullCheck(
  repository: string,
  pr: number,
  deps: PullCheckDeps,
): Promise<PullCheckResult> {
  assertPullTarget(repository, pr)
  const source = await resolvePolicyFromConfig(deps.env, deps.cwd, repository)
  return await runPullCheck({ repository, pr, ...source }, deps)
}
