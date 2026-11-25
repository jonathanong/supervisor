import { isPlainObject, resolveLocalValue } from './locals.js'
import {
  POLICY_LIMITS,
  type ClaudeAction,
  type PolicyValidationError,
  type SeatSet,
  type Verdict,
  type VerdictPatch,
} from './types.js'
import { checkAllowedKeys, isTeamItem, parsePeopleList } from './validate-parts.js'

const CLAUDE_ACTIONS = new Set<ClaudeAction>(['approves', 'comments', 'blocks'])
const VERDICT_KEYS = new Set(['claude', 'seats', 'max_age'])
const SET_KEYS = new Set(['count', 'from'])
const SPECIAL_PEOPLE = new Set([
  'humans',
  'bots',
  'everyone',
  'nobody',
  'pr/authors',
  'pr/opened_by',
  'pr/approved_by',
])

function parseMaxAge(
  raw: unknown,
  allowUnset: boolean,
  path: string,
  file: string,
  errors: PolicyValidationError[],
): string | undefined {
  if (raw === 'unset' && allowUnset) return 'unset'
  if (typeof raw !== 'string') {
    errors.push({ file, path, message: 'max_age must be a duration string (e.g. 24h, 7d)' })
    return undefined
  }
  const match = /^([1-9][0-9]*)([smhd])$/.exec(raw)
  if (!match) {
    errors.push({ file, path, message: `Invalid max_age '${raw}'` })
    return undefined
  }
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
  const seconds = Number(match[1]) * mult[match[2]!]!
  if (seconds < POLICY_LIMITS.minMaxAgeSeconds || seconds > POLICY_LIMITS.maxMaxAgeSeconds) {
    errors.push({ file, path, message: `max_age '${raw}' must be between 1m and 83d` })
    return undefined
  }
  return raw
}

export function parseSeats(
  raw: unknown,
  locals: Record<string, unknown>,
  path: string,
  file: string,
  errors: PolicyValidationError[],
): SeatSet[] {
  const resolved = resolveLocalValue(raw, locals, path, file, errors)
  if (typeof resolved === 'number') {
    if (!Number.isInteger(resolved) || resolved < 0 || resolved > POLICY_LIMITS.maxSeats) {
      errors.push({
        file,
        path,
        message: `seats must be an integer from 0 to ${POLICY_LIMITS.maxSeats}`,
      })
      return []
    }
    return resolved === 0 ? [] : [{ count: resolved, from: ['humans'] }]
  }
  if (!Array.isArray(resolved)) {
    errors.push({ file, path, message: 'seats must be an integer or a list of seat sets' })
    return []
  }
  if (resolved.length > POLICY_LIMITS.maxSeatSets) {
    errors.push({
      file,
      path,
      message: `seats exceeds maximum of ${POLICY_LIMITS.maxSeatSets} sets`,
    })
  }
  const sets: SeatSet[] = []
  let totalTeams = 0
  for (let i = 0; i < resolved.length; i += 1) {
    const sp = `${path}[${i}]`
    const entry = resolveLocalValue(resolved[i], locals, sp, file, errors)
    if (!isPlainObject(entry)) {
      errors.push({ file, path: sp, message: 'Seat set must be an object with count and from' })
      continue
    }
    checkAllowedKeys(entry, SET_KEYS, sp, file, errors)
    const count = entry.count
    if (
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < POLICY_LIMITS.minSetCount ||
      count > POLICY_LIMITS.maxSetCount
    ) {
      errors.push({
        file,
        path: `${sp}.count`,
        message: `count must be an integer from 1 to ${POLICY_LIMITS.maxSetCount}`,
      })
      continue
    }
    const from = parsePeopleList(entry.from, locals, {}, `${sp}.from`, file, errors)
    totalTeams += from.filter(isTeamItem).length
    const allLogins =
      from.length > 0 &&
      from.every(
        (item) =>
          !item.startsWith('!') &&
          !item.startsWith('bot:') &&
          !item.includes('/') &&
          !SPECIAL_PEOPLE.has(item),
      )
    if (allLogins && count > from.length) {
      errors.push({
        file,
        path: `${sp}.count`,
        message: `count (${count}) exceeds number of logins (${from.length})`,
      })
    }
    sets.push({ count, from })
  }
  if (totalTeams > POLICY_LIMITS.maxTeamsPerList) {
    errors.push({
      file,
      path,
      message: `seats exceeds maximum of ${POLICY_LIMITS.maxTeamsPerList} teams`,
    })
  }
  return sets
}

export function parseVerdict(
  raw: unknown,
  locals: Record<string, unknown>,
  isOverride: boolean,
  path: string,
  file: string,
  errors: PolicyValidationError[],
): Verdict | VerdictPatch | undefined {
  const resolved = resolveLocalValue(raw, locals, path, file, errors)
  if (!isPlainObject(resolved)) {
    errors.push({ file, path, message: 'verdict must be an object' })
    return undefined
  }
  checkAllowedKeys(resolved, VERDICT_KEYS, path, file, errors)
  let claude: ClaudeAction | undefined
  if (resolved.claude !== undefined) {
    if (
      typeof resolved.claude !== 'string' ||
      !CLAUDE_ACTIONS.has(resolved.claude as ClaudeAction)
    ) {
      errors.push({
        file,
        path: `${path}.claude`,
        message: "claude must be 'approves', 'comments', or 'blocks'",
      })
    } else {
      claude = resolved.claude as ClaudeAction
    }
  } else if (!isOverride) {
    errors.push({ file, path: `${path}.claude`, message: 'verdict.claude is required' })
  }
  let seats: SeatSet[] | undefined
  if (resolved.seats !== undefined) {
    if (claude === 'blocks') {
      errors.push({
        file,
        path: `${path}.seats`,
        message: "seats is not allowed beside claude: 'blocks'",
      })
    } else {
      seats = parseSeats(resolved.seats, locals, `${path}.seats`, file, errors)
    }
  } else if (!isOverride && claude && claude !== 'blocks') {
    errors.push({
      file,
      path: `${path}.seats`,
      message: 'verdict.seats is required when claude is not blocks',
    })
  }
  const maxAge =
    resolved.max_age !== undefined
      ? parseMaxAge(resolved.max_age, isOverride, `${path}.max_age`, file, errors)
      : undefined
  if (isOverride) {
    return {
      ...(claude ? { claude } : {}),
      ...(seats ? { seats } : {}),
      ...(maxAge ? { maxAge: maxAge as string | 'unset' } : {}),
    }
  }
  return { claude: claude ?? 'comments', seats: seats ?? [], ...(maxAge ? { maxAge } : {}) }
}
