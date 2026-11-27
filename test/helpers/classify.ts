import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach } from 'vitest'
import { runCli } from '../../src/cli/run.js'
import type { RunProcess } from '../../src/state/process.js'
import { done, type CliResult } from './loop.js'
import { HEAD, REPO } from './pull.js'

export interface FakeGh {
  /** The head each read of the pull request answers, in order; the last one repeats. */
  heads?: string[]
  diff?: string
  /** The exit code of the diff call. */
  diffCode?: number
}

export const DIFF = 'diff --git a/src/a.ts b/src/a.ts\n-await sleep(50)\n+await queue.idle()\n'

/**
 * A fake `gh api`. The pull request has a title, a body and an author that it would hand over
 * if asked for them; each call here answers only the head or the diff.
 */
export function classifyGh(options: FakeGh = {}): { run: RunProcess; calls: string[][] } {
  const calls: string[][] = []
  const heads = [...(options.heads ?? [HEAD])]
  const run: RunProcess = async (command, args) => {
    if (command !== 'gh' || args[0] !== 'api') throw new Error(`unexpected process: ${command}`)
    calls.push(args)
    if (args.includes('Accept: application/vnd.github.diff')) {
      const code = options.diffCode ?? 0
      return code === 0 ? done(options.diff ?? DIFF) : done('', code, 'gh: diff too large')
    }
    const head = heads.length > 1 ? heads.shift() : heads[0]
    return done(`${JSON.stringify({ head })}\n`)
  }
  return { run, calls }
}

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'supervisor-classify-'))
  dirs.push(dir)
  return dir
}

/** Write files under a directory, by relative path. */
export async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
}

export async function policy(
  args: string[],
  run: RunProcess,
  env: Record<string, string> = {},
): Promise<CliResult> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(['policy', ...args], {
    env,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    startMcp: async () => undefined,
    runProcess: run,
    shepherdStatus: async () => {
      throw new Error('pr-shepherd must not be asked')
    },
    now: () => new Date(0),
  })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

export const PR = [REPO, '7']
