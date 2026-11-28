import { isObject } from '../state/json.js'
import type { RunProcess } from '../state/process.js'
import { stripCredentials } from './redact.js'

/** Raised when a PR MCP tool receives invalid arguments or a GitHub call fails. */
export class PrToolError extends Error {}

const GH_TIMEOUT_MS = 120_000

export async function runGh(run: RunProcess, args: string[], label: string): Promise<string> {
  const done = await run('gh', args, { timeoutMs: GH_TIMEOUT_MS })
  if (done.code !== 0) {
    const detail = stripCredentials(done.stderr.trim().slice(0, 200)).text
    throw new PrToolError(`gh ${label} exited ${done.code}: ${detail}`)
  }
  return done.stdout
}

export async function ghJson(run: RunProcess, args: string[], label: string): Promise<unknown> {
  const stdout = await runGh(run, args, label)
  try {
    return JSON.parse(stdout) as unknown
  } catch {
    throw new PrToolError(`gh ${label} returned invalid JSON`)
  }
}

export async function ghJsonLines(
  run: RunProcess,
  args: string[],
  label: string,
): Promise<Array<Record<string, unknown>>> {
  const stdout = await runGh(run, args, label)
  try {
    const values = stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as unknown)
    if (!values.every(isObject)) {
      throw new PrToolError(`gh ${label} returned a non-object item`)
    }
    return values
  } catch (err) {
    if (err instanceof PrToolError) throw err
    throw new PrToolError(`gh ${label} returned invalid JSON`)
  }
}
