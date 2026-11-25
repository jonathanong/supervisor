import type {
  ComparisonOp,
  DiffRating,
  EvaluationFacts,
  ReviewDepth,
  SeverityLevel,
} from './types.js'

export const SEVERITY_RANK: Record<SeverityLevel, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
}

export const DEPTH_RANK: Record<ReviewDepth, number> = {
  quick: 1,
  standard: 2,
  deep: 3,
}

export const DIFF_RANK: Record<DiffRating, number> = {
  trivial: 1,
  same_intent: 2,
  different: 3,
}

export function compareNumbers(a: number, op: ComparisonOp, b: number): boolean {
  switch (op) {
    case '=':
      return a === b
    case '!=':
      return a !== b
    case '<':
      return a < b
    case '<=':
      return a <= b
    case '>':
      return a > b
    case '>=':
      return a >= b
  }
}

export function accountMatchesList(
  account: string,
  items: string[],
  facts: EvaluationFacts,
): boolean {
  const bots = new Set(facts.bots ?? [])
  const teams = facts.teams ?? {}
  const authors = new Set(facts.authors ?? [])
  const isBot = account.startsWith('bot:') || bots.has(account)

  const matchSingle = (item: string): boolean => {
    if (item === 'everyone') return true
    if (item === 'humans') return !isBot
    if (item === 'bots') return isBot
    if (item === 'pr/authors') return authors.has(account)
    if (item === 'pr/opened_by') return facts.openedBy === account
    if (item.includes('/')) return (teams[item] ?? []).includes(account)
    return item === account
  }

  let included = false
  for (const raw of items) {
    if (raw.startsWith('!')) {
      if (matchSingle(raw.slice(1))) return false
    } else if (!included && matchSingle(raw)) {
      included = true
    }
  }
  return included
}
