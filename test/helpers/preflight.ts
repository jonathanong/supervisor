import type { ProcessResult, RunProcess } from '../../src/state/process.js'
import { done } from './loop.js'

export interface Calls {
  run: RunProcess
  seen: string[]
}

/** A runner that answers by command name and records each call; an Error is thrown. */
export function fake(replies: Record<string, ProcessResult | Error>): Calls {
  const seen: string[] = []
  const run: RunProcess = async (command, args) => {
    seen.push([command, ...args].join(' '))
    const reply = replies[command] ?? done('', 1, 'no reply')
    if (reply instanceof Error) {
      throw reply
    }
    return reply
  }
  return { run, seen }
}

export const GOOD = {
  gh: done("Logged in\n  - Token scopes: 'repo', 'read:org'\n"),
  'pr-shepherd': done('pr-shepherd 1.2.3\n'),
  npx: done('0.4.1\n'),
}
