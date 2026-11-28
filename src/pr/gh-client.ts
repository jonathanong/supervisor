import { isObject } from '../state/json.js'
import type { RunProcess } from '../state/process.js'
import { stripCredentials } from './redact.js'

/** The one list of codes a PR MCP tool error can carry. */
export const PR_TOOL_ERROR_CODES = [
  'invalid-argument',
  'validation-failed',
  'gh-failed',
  'gh-invalid-response',
  'not-found',
  'pr-partially-written',
] as const

export type PrToolErrorCode = (typeof PR_TOOL_ERROR_CODES)[number]

/** Raised when a PR MCP tool receives invalid arguments or a GitHub call fails. */
export class PrToolError extends Error {
  readonly code: PrToolErrorCode
  readonly details: Record<string, unknown>

  constructor(
    code: PrToolErrorCode,
    message: string,
    options: { cause?: unknown; details?: Record<string, unknown> } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'PrToolError'
    this.code = code
    this.details = options.details ?? {}
  }
}

const GH_TIMEOUT_MS = 120_000

export async function runGh(run: RunProcess, args: string[], label: string): Promise<string> {
  const done = await run('gh', args, { timeoutMs: GH_TIMEOUT_MS })
  if (done.code !== 0) {
    const detail = stripCredentials(done.stderr.trim()).text.slice(0, 200)
    throw new PrToolError('gh-failed', `gh ${label} exited ${done.code}: ${detail}`)
  }
  return done.stdout
}

export async function ghJson(run: RunProcess, args: string[], label: string): Promise<unknown> {
  const stdout = await runGh(run, args, label)
  try {
    return JSON.parse(stdout) as unknown
  } catch (err) {
    throw new PrToolError('gh-invalid-response', `gh ${label} returned invalid JSON`, {
      cause: err,
    })
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
      throw new PrToolError('gh-invalid-response', `gh ${label} returned a non-object item`)
    }
    return values
  } catch (err) {
    if (err instanceof PrToolError) throw err
    throw new PrToolError('gh-invalid-response', `gh ${label} returned invalid JSON`, {
      cause: err,
    })
  }
}
