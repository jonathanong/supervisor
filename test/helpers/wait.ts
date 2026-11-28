import type { ProcessOptions, RunProcess } from '../../src/state/process.js'
import { graphqlReply, type PullFixture } from './gh.js'
import { done, NOW, type LoopCliExtra } from './loop.js'

export interface Call {
  command: string
  args: string[]
  options: ProcessOptions | undefined
}

export interface RelayRequest {
  url: string
  owner: string | null
  repos: string | null
  after: string | null
  filters: string | null
  auth: string | null
}

export type RelayReply =
  | { events: Array<Record<string, unknown>>; cursor?: string; gap?: boolean; timedOut?: boolean }
  | { status: number; body?: unknown }
  | Error
  | 'abort'

export interface World {
  run: RunProcess
  calls: Call[]
  fetch: typeof fetch
  requests: RelayRequest[]
  timeouts: number[]
  io: LoopCliExtra
}

export interface WorldOptions {
  listing?: string
  login?: string | number
  replies?: RelayReply[] | ((req: RelayRequest) => RelayReply)
  pulls?: Record<string, PullFixture>
  onPoll?: (req: RelayRequest) => void | Promise<void>
}

export function encodeCursor(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url')
}

export function decodeCursor(text: string): Record<string, any> {
  return JSON.parse(Buffer.from(text, 'base64url').toString('utf8'))
}

function jsonResponse(body: unknown, status = 200): Response {
  const init = { status, headers: { 'content-type': 'application/json' } }
  return new Response(body === undefined ? '' : JSON.stringify(body), init)
}

/** A fake `gh` runner and fake `fetch` relay; nothing is spawned and no network is touched. */
export function makeWorld(options: WorldOptions = {}): World {
  const queue = Array.isArray(options.replies) ? [...options.replies] : undefined
  const respond = typeof options.replies === 'function' ? options.replies : undefined
  const calls: Call[] = []
  const requests: RelayRequest[] = []
  const timeouts: number[] = []
  let abortCurrent: AbortController | undefined
  let abortOnNextSleep = false
  let seq = 0

  const run: RunProcess = async (command, args, processOptions) => {
    calls.push({ command, args, options: processOptions })
    if (args[1] === 'user') {
      const { login = 'signed-in-user' } = options
      return typeof login === 'number' ? done('', login, 'gh: not signed in') : done(`${login}\n`)
    }
    if (args[1] === '--paginate') {
      return done(options.listing ?? 'example-repo\tfalse\nother-repo\tfalse\n')
    }
    const value = (name: string) => args.find((arg) => arg.startsWith(`${name}=`))!.slice(2)
    return graphqlReply(args, options.pulls?.[`${value('o')}/${value('n')}#${value('p')}`] ?? {})
  }

  const fakeFetch: typeof fetch = async (input, init) => {
    const parsed = new URL(typeof input === 'string' ? input : input.toString())
    const headers = new Headers(init?.headers)
    const req: RelayRequest = {
      url: parsed.href,
      owner: parsed.searchParams.get('owner'),
      repos: parsed.searchParams.get('repos'),
      after: parsed.searchParams.get('after'),
      filters: parsed.searchParams.get('filters'),
      auth: headers.get('authorization'),
    }
    requests.push(req)
    await options.onPoll?.(req)
    const reply = queue ? queue.shift() : respond?.(req)
    if (reply === undefined) {
      throw new Error(`unexpected relay poll for ${req.owner ?? '(no owner)'}`)
    }
    if (reply === 'abort') {
      abortCurrent?.abort(new DOMException('timed out', 'TimeoutError'))
      throw new DOMException('timed out', 'TimeoutError')
    }
    if (reply instanceof Error) throw reply
    if ('status' in reply) return jsonResponse(reply.body, reply.status)
    if (reply.timedOut) abortOnNextSleep = true
    seq += 1
    const cursor = reply.cursor ?? `${Date.parse(NOW) + seq}#${seq}`
    return jsonResponse({ events: reply.events, cursor, gap: reply.gap ?? false })
  }

  const sleep = async (_ms: number, _signal: AbortSignal): Promise<void> => {
    if (abortOnNextSleep) {
      abortOnNextSleep = false
      abortCurrent?.abort(new DOMException('timed out', 'TimeoutError'))
    }
  }

  const timeoutSignal = (ms: number): AbortSignal => {
    timeouts.push(ms)
    abortCurrent = new AbortController()
    return abortCurrent.signal
  }

  return {
    run,
    calls,
    fetch: fakeFetch,
    requests,
    timeouts,
    io: { fetch: fakeFetch, sleep, timeoutSignal },
  }
}

export const ORG_ONLY = {
  scopes: [
    {
      owner: 'example-org',
      kind: 'org',
      repos: '*',
      excludeForks: true,
      excludedRepos: ['archived-repo'],
      mode: 'enforce',
    },
  ],
}

export function envelope(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    v: 1,
    id: 'e1',
    receivedAt: NOW,
    event: 'workflow_run',
    action: 'completed',
    owner: 'example-org',
    repo: 'example-org/example-repo',
    prs: [],
    issue: null,
    headSha: null,
    headRef: 'main',
    baseRef: null,
    reason: null,
    conclusion: 'failure',
    workflow: 'ci',
    workflowId: null,
    runId: 77,
    command: null,
    commentId: null,
    sender: { login: 'example-user', type: 'User' },
    authorAssociation: 'MEMBER',
    url: null,
    ...fields,
  }
}

export function mergeEvent(id: string, repo: string, number: number, login = 'example-user') {
  const owner = repo.includes('/') ? repo.split('/')[0]! : 'example-org'
  return envelope({
    id,
    owner,
    repo,
    event: 'pull_request',
    action: 'closed',
    prs: [number],
    headRef: null,
    conclusion: null,
    workflow: null,
    runId: null,
    sender: null,
    payload: { pull_request: { merged: true, number, user: { login } } },
  })
}

export function lines(stdout: string): Array<Record<string, any>> {
  return stdout
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line))
}
