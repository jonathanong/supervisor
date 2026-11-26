import type { RunProcess } from '../state/process.js'
import { accountName, ghObjects } from './facts-gh.js'
import type { ConditionExpr, PolicyFile, SeatSet } from './types.js'

const TEAM = /^[\w.-]+\/[\w.-]+$/
const PEOPLE_FACTS = new Set(['pr/authors', 'pr/approved_by', 'pr/opened_by'])

function addNames(items: string[], teams: Set<string>): void {
  for (const raw of items) {
    const item = raw.startsWith('!') ? raw.slice(1) : raw
    if (TEAM.test(item) && !item.startsWith('pr/')) teams.add(item)
  }
}

function addFromSeats(seats: SeatSet[] | undefined, teams: Set<string>): void {
  for (const set of seats ?? []) addNames(set.from, teams)
}

function addFromCondition(expr: ConditionExpr, teams: Set<string>): void {
  if (expr.kind === 'literal') return
  if (expr.kind === 'logical') {
    for (const item of expr.items) addFromCondition(item, teams)
    return
  }
  if (expr.lhs.kind !== 'fact' || !PEOPLE_FACTS.has(expr.lhs.name)) return
  if (expr.rhs.kind === 'list') addNames(expr.rhs.items, teams)
  else if (expr.rhs.kind === 'string') addNames([expr.rhs.value], teams)
}

/** Every `<org>/<team>` a seat or a people condition of these policies names, sorted. */
export function teamsNamed(policies: PolicyFile[]): string[] {
  const teams = new Set<string>()
  for (const rule of policies.flatMap((policy) => policy.rules)) {
    addFromCondition(rule.if, teams)
    addFromSeats(rule.verdict?.seats, teams)
    for (const override of rule.override) {
      addFromCondition(override.if, teams)
      addFromSeats(override.verdict?.seats, teams)
    }
  }
  return [...teams].sort()
}

/**
 * The members of each team. A team that cannot be read fails the collection: an unknown
 * membership would leave a seat such as `[humans, '!<org>/<team>']` open to its members.
 */
export async function collectTeams(
  run: RunProcess,
  teams: string[],
): Promise<Record<string, string[]>> {
  const members: Record<string, string[]> = {}
  for (const team of teams) {
    const [org, slug] = team.split('/')
    const endpoint = `orgs/${org}/teams/${slug}/members?per_page=100`
    const listed = await ghObjects(run, endpoint, '.[] | {login, type}', true)
    members[team] = listed.flatMap((member) => accountName(member) ?? [])
  }
  return members
}
