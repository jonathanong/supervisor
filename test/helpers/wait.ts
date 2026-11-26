import type { ProcessOptions, RunProcess } from '../../src/state/process.js'
import { graphqlReply, type PullFixture } from './gh.js'
import { done } from './loop.js'

export interface Call {
  command: string
  args: string[]
  options: ProcessOptions | undefined
}

export interface World {
  run: RunProcess
  calls: Call[]
  /** The `npx hook-harness` calls only. */
  waits: () => string[][]
}

export interface WorldOptions {
  /** The repository listing `gh` prints: `name<TAB>fork` lines. */
  listing?: string
  /** One entry per hook-harness wait, in order: its JSON result, or a non-zero exit code. */
  results?: Array<Record<string, unknown> | number | string>
  /** Late-review fixtures by `owner/repo#N`; a pull request not listed is clean. */
  pulls?: Record<string, PullFixture>
  /** Called before each hook-harness wait returns, for example to move the clock. */
  onWait?: () => void
}

/** A fake process runner for `gh` and `npx hook-harness`; nothing is spawned. */
export function makeWorld(options: WorldOptions = {}): World {
  const results = [...(options.results ?? [])]
  const calls: Call[] = []
  const run: RunProcess = async (command, args, processOptions) => {
    calls.push({ command, args, options: processOptions })
    if (command === 'npx') {
      options.onWait?.()
      const next = results.shift()
      if (next === undefined) throw new Error('unexpected hook-harness wait')
      if (typeof next === 'number') return done('', next)
      return done(typeof next === 'string' ? next : JSON.stringify(next))
    }
    if (args[1] === '--paginate') {
      return done(options.listing ?? 'example-repo\tfalse\nother-repo\tfalse\n')
    }
    const value = (name: string) => args.find((arg) => arg.startsWith(`${name}=`))!.slice(2)
    return graphqlReply(args, options.pulls?.[`${value('o')}/${value('n')}#${value('p')}`] ?? {})
  }
  return {
    run,
    calls,
    waits: () => calls.filter((call) => call.command === 'npx').map((call) => call.args),
  }
}

/** A merged pull-request event as hook-harness reports it. */
export function mergeEvent(id: string, repo: string, number: number, login = 'example-user') {
  return {
    id,
    repo,
    event: 'pull_request',
    action: 'closed',
    prs: [number],
    payload: { pull_request: { merged: true, number, user: { login } } },
  }
}

/** The parsed lines of a wait's stdout: the summary first, then events and triggers. */
export function lines(stdout: string): Array<Record<string, any>> {
  return stdout
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line))
}
