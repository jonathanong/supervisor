import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { requireStateDir, type LoadedConfig } from '../config/load.js'
import type { RunProcess } from '../state/process.js'
import { readStop } from '../state/stop.js'

export interface Check {
  name: string
  ok: boolean
  detail: string
}

const TIMEOUT_MS = 120_000

function message(error: unknown): string {
  return (error as Error).message
}

/** The first non-empty line of some output, trimmed and capped, so a detail is always one line. */
function firstLine(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim() !== '') ?? ''
  return line.trim().slice(0, 200)
}

/** Run one command and report its first output line, or why it failed. */
async function probe(
  run: RunProcess,
  name: string,
  command: string,
  args: string[],
  cwd?: string,
): Promise<Check> {
  try {
    const result = await run(command, args, { ...(cwd ? { cwd } : {}), timeoutMs: TIMEOUT_MS })
    const output = (result.stdout || result.stderr).trim()
    if (result.code !== 0) {
      return { name, ok: false, detail: `exited ${result.code}: ${firstLine(output)}` }
    }
    return { name, ok: true, detail: firstLine(output) }
  } catch (error) {
    return { name, ok: false, detail: firstLine(message(error)) }
  }
}

/** `gh auth status`; the token scopes are in its text, on stdout or stderr by gh version. */
export async function checkGh(run: RunProcess): Promise<Check> {
  try {
    const result = await run('gh', ['auth', 'status'], { timeoutMs: TIMEOUT_MS })
    const output = `${result.stdout}\n${result.stderr}`.trim()
    if (result.code !== 0) {
      return { name: 'gh', ok: false, detail: `exited ${result.code}: ${firstLine(output)}` }
    }
    const match = /Token scopes:\s*(.+)/.exec(output)
    const scopes = match ? match[1]!.replaceAll("'", '').trim() : ''
    return { name: 'gh', ok: true, detail: scopes ? `scopes: ${scopes}` : 'authenticated' }
  } catch (error) {
    return { name: 'gh', ok: false, detail: firstLine(message(error)) }
  }
}

export function checkShepherd(run: RunProcess): Promise<Check> {
  return probe(run, 'pr-shepherd', 'pr-shepherd', ['--version'])
}

/** True when the config file itself sets `eventWait`; the loaded config always has defaults. */
async function eventWaitSet(path: string): Promise<boolean> {
  const data: unknown = JSON.parse(await readFile(path, 'utf8'))
  return (data as { eventWait?: unknown }).eventWait !== undefined
}

export async function checkHarness(
  run: RunProcess,
  loaded: LoadedConfig | undefined,
): Promise<Check> {
  if (loaded === undefined) {
    return { name: 'hook-harness', ok: false, detail: 'skipped: the config did not load' }
  }
  if (!(await eventWaitSet(loaded.path))) {
    return { name: 'hook-harness', ok: true, detail: 'not configured' }
  }
  const version = loaded.config.eventWait.hookHarness
  const args = ['-y', `hook-harness@${version}`, '--version']
  return probe(run, 'hook-harness', 'npx', args, tmpdir())
}

export async function checkStop(loaded: LoadedConfig | undefined): Promise<Check> {
  const name = 'stop'
  if (loaded === undefined) {
    return { name, ok: false, detail: 'unknown: the config did not load' }
  }
  try {
    const stop = await readStop(requireStateDir(loaded))
    if (stop === undefined) {
      return { name, ok: true, detail: 'not stopped' }
    }
    const since = stop.at === null ? '' : ` since ${stop.at}`
    return { name, ok: false, detail: `stopped${since}${stop.reason ? `: ${stop.reason}` : ''}` }
  } catch (error) {
    return { name, ok: false, detail: firstLine(message(error)) }
  }
}
