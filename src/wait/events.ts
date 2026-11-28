import { get, isObject, type Json, type JsonObject } from '../state/json.js'

const FIELDS = [
  'id',
  'repo',
  'event',
  'action',
  'prs',
  'issue',
  'reason',
  'conclusion',
  'workflow',
  'runId',
  'command',
  'commentId',
  'headSha',
]

function isEmpty(value: Json | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function pullOf(event: JsonObject): JsonObject | undefined {
  const payload = get(event, 'payload')
  const pull = isObject(payload) ? get(payload, 'pull_request') : undefined
  return isObject(pull) ? pull : undefined
}

/**
 * One stable line for an event: the fields the loop uses, in a fixed order, without empty values.
 * Event payloads are untrusted data; nothing here interprets their text.
 */
export function compact(event: JsonObject): JsonObject {
  const line: JsonObject = {}
  for (const key of FIELDS) {
    const value = get(event, key)
    if (!isEmpty(value)) {
      line[key] = key === 'repo' && typeof value === 'string' ? fullRepo(event) : value!
    }
  }
  const sender = get(event, 'sender')
  if (sender) {
    line.sender = isObject(sender) ? (get(sender, 'login') ?? null) : null
  }
  const pull = pullOf(event)
  if (event.event === 'pull_request' && pull !== undefined) {
    line.merged = pull.merged === true
  }
  return line
}

export function isMerge(event: JsonObject): boolean {
  return (
    event.event === 'pull_request' && event.action === 'closed' && pullOf(event)?.merged === true
  )
}

/** The event's repository as `owner/repo`; the event's own owner fills in a bare name. */
function fullRepo(event: JsonObject): string {
  const repo = typeof event.repo === 'string' ? event.repo : ''
  const owner = typeof event.owner === 'string' ? event.owner : ''
  return repo.includes('/') || owner === '' ? repo : `${owner}/${repo}`
}

/** `owner/repo#N` for a merge event. */
export function refOf(event: JsonObject): string {
  const prs = get(event, 'prs')
  const number = pullOf(event)!.number || (Array.isArray(prs) ? prs[0] : undefined)
  return `${fullRepo(event)}#${String(number ?? 'None')}`
}

function login(name: Json | undefined): string {
  return (typeof name === 'string' ? name : '')
    .replace(/^app\//, '')
    .replace(/\[bot\]$/, '')
    .toLowerCase()
}

/** True when the pull request's author is the configured dependency bot. */
export function isDependencyBot(event: JsonObject, author: string): boolean {
  const user = pullOf(event)?.user
  return login(isObject(user) ? get(user, 'login') : undefined) === login(author)
}
