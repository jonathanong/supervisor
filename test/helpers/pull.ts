import { fileURLToPath } from 'node:url'
import { runCli } from '../../src/cli/run.js'
import type { RunProcess } from '../../src/state/process.js'
import { done, type CliResult } from './loop.js'

export const REPO = 'example-org/example-repo'
export const HEAD = 'a'.repeat(40)
export const OLD_HEAD = 'b'.repeat(40)

export const policyDir = (name: string) =>
  fileURLToPath(new URL(`../fixtures/policies/${name}`, import.meta.url))

const user = (login: string, type = 'User') => ({ login, type })
export const DEV = user('dev-one')
export const REVIEWER = user('example-reviewer[bot]', 'Bot')
export const NOBODY = { login: null, type: null }

/** What each `gh api` call prints after its jq filter; each list is one JSON value per line. */
export interface GhFixture {
  pull: Record<string, unknown>
  files: unknown[]
  commits: unknown[]
  reviews: unknown[]
  /** The head's checks as GraphQL lists them; `null` is a head with no check rollup. */
  contexts: unknown[] | null
  /** The head GraphQL read the checks of, and whether it has more than 100 checks. */
  checksHead: unknown
  checksMore: boolean
  /** GitHub's `mergeStateStatus` of the pull request. */
  mergeState: unknown
  teams: Record<string, unknown[]>
  /** The head the pull request has when it is read again at the end. */
  headAfter: unknown
  /** Raw replies by a substring of the endpoint: stdout, or an exit code. */
  raw: Record<string, string | number>
}

export const file = (filename: string, status = 'modified', previous: string | null = null) => ({
  filename,
  previous,
  status,
})
export const commit = (author: unknown, sha = HEAD) => ({ sha, author })
export const review = (reviewer: unknown, state: string, commitId = HEAD) => ({
  user: reviewer,
  state,
  commit: commitId,
})

/** A check run as GraphQL lists it; `isRequired` is whether the base branch requires it. */
export const checkRun = (
  name: string,
  status: string,
  conclusion: string | null = null,
  isRequired = false,
) => ({ __typename: 'CheckRun', name, status, conclusion, isRequired })
export const statusContext = (context: string, state: string, isRequired = false) => ({
  __typename: 'StatusContext',
  context,
  state,
  isRequired,
})

/** A one-file pull request by `dev-one` that the reviewer bot approved and whose checks passed. */
export function fixture(overrides: Partial<GhFixture> = {}): GhFixture {
  const files = overrides.files ?? [file('src/index.ts')]
  const commits = overrides.commits ?? [commit(DEV)]
  return {
    files,
    commits,
    reviews: [review(REVIEWER, 'APPROVED')],
    contexts: [checkRun('test', 'COMPLETED', 'SUCCESS')],
    checksHead: HEAD,
    checksMore: false,
    mergeState: 'CLEAN',
    teams: {},
    headAfter: HEAD,
    raw: {},
    ...overrides,
    pull: {
      head: HEAD,
      base: 'main',
      user: DEV,
      labels: ['automation'],
      additions: 7,
      deletions: 5,
      files: files.length,
      commits: commits.length,
      state: 'open',
      draft: false,
      ...overrides.pull,
    },
  }
}

const lines = (values: unknown[]) => values.map((value) => `${JSON.stringify(value)}\n`).join('')

function reply(endpoint: string, jq: string, gh: GhFixture): string {
  if (endpoint.startsWith('orgs/')) {
    const [, org, , slug] = endpoint.split('/')
    return lines(gh.teams[`${org}/${slug}`]!)
  }
  if (endpoint.includes('/files?')) return lines(gh.files)
  if (endpoint === 'graphql') {
    const more = gh.contexts === null ? null : gh.checksMore
    return lines([{ mergeState: gh.mergeState, oid: gh.checksHead, more, contexts: gh.contexts }])
  }
  if (endpoint.includes('/commits?')) return lines(gh.commits)
  if (endpoint.includes('/reviews?')) return lines(gh.reviews)
  if (endpoint !== `repos/${REPO}/pulls/7`) throw new Error(`unexpected endpoint: ${endpoint}`)
  return lines([jq === '{head: .head.sha}' ? { head: gh.headAfter } : gh.pull])
}

/** A fake `gh api` that answers from a fixture and records each call's arguments. */
export function fakeGh(gh: GhFixture): { run: RunProcess; calls: string[][] } {
  const calls: string[][] = []
  const run: RunProcess = async (command, args) => {
    if (command !== 'gh' || args[0] !== 'api') throw new Error(`unexpected process: ${command}`)
    calls.push(args)
    const endpoint = args.find(
      (arg) => arg === 'graphql' || arg.startsWith('repos/') || arg.startsWith('orgs/'),
    )!
    const raw = Object.entries(gh.raw).find(([part]) => endpoint.includes(part))?.[1]
    if (typeof raw === 'number') return done('', raw, 'gh: Not Found (HTTP 404)')
    return done(raw ?? reply(endpoint, args.at(-1)!, gh))
  }
  return { run, calls }
}

/** Run `supervisor policy check example-org/example-repo 7 ...` against a fixture. */
export async function check(
  gh: GhFixture,
  options: string[] = ['--dir', policyDir('pull-facts'), '--json'],
): Promise<CliResult & { calls: string[][] }> {
  const { run, calls } = fakeGh(gh)
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(['policy', 'check', REPO, '7', ...options], {
    env: {},
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    startMcp: async () => undefined,
    runProcess: run,
    now: () => new Date(0),
  })
  return { code, stdout: out.join(''), stderr: err.join(''), calls }
}
