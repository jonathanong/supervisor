import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli, type CliIo } from '../../src/cli/run.js'
import type { ProcessResult, RunProcess } from '../../src/state/process.js'

const exampleUrl = new URL('../../examples/config.example.json', import.meta.url)
const tempDirs: string[] = []

export const NOW = '2026-01-02T03:04:05Z'
export const TEST_RELAY_URL = 'https://relay.example.test'
export const TEST_RELAY_TOKEN = 'hh_test_token'

export interface CliResult {
  code: number
  stdout: string
  stderr: string
}

export type LoopCliExtra = Pick<CliIo, 'fetch' | 'sleep' | 'timeoutSignal'>

export interface Loop {
  stateDir: string
  env: Record<string, string | undefined>
  cli: (
    args: string[],
    runProcess?: RunProcess,
    now?: () => Date,
    extra?: LoopCliExtra,
  ) => Promise<CliResult>
  state: () => Promise<Record<string, any>>
  seed: (state: unknown) => Promise<void>
}

/** A process result with defaults, for a fake runner. */
export function done(stdout = '', code = 0, stderr = ''): ProcessResult {
  return { code, stdout, stderr }
}

const unexpected: RunProcess = async (command) => {
  throw new Error(`unexpected process: ${command}`)
}

/** A config (the example plus `overrides`) whose state directory is a fresh temporary one. */
export async function makeLoop(overrides: Record<string, unknown> = {}): Promise<Loop> {
  const root = await mkdtemp(join(tmpdir(), 'supervisor-loop-'))
  tempDirs.push(root)
  const stateDir = join(root, 'state')
  const configPath = join(root, 'config.json')
  const config = { ...JSON.parse(await readFile(exampleUrl, 'utf8')), stateDir, ...overrides }
  await writeFile(configPath, JSON.stringify(config), 'utf8')
  const env: Record<string, string | undefined> = {
    SUPERVISOR_CONFIG: configPath,
    HOOK_HARNESS_CONFIG_DIR: join(root, 'hook-harness'),
    HOOK_HARNESS_URL: TEST_RELAY_URL,
    HOOK_HARNESS_TOKEN: TEST_RELAY_TOKEN,
  }
  return {
    stateDir,
    env,
    cli: async (args, runProcess = unexpected, now = () => new Date(NOW), extra = {}) => {
      const out: string[] = []
      const err: string[] = []
      const code = await runCli(args, {
        env,
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        startMcp: async () => undefined,
        runProcess,
        shepherdStatus: async () => {
          throw new Error('unexpected pr-shepherd call')
        },
        now,
        ...extra,
      })
      return { code, stdout: out.join(''), stderr: err.join('') }
    },
    state: async () => JSON.parse(await readFile(join(stateDir, 'state.json'), 'utf8')),
    seed: async (state) => {
      await mkdir(stateDir, { recursive: true })
      await writeFile(join(stateDir, 'state.json'), JSON.stringify(state), 'utf8')
    },
  }
}

export async function cleanupLoops(): Promise<void> {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true })
  }
}
