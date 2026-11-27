import { parseArgs } from 'node:util'
import { loadConfig, type LoadedConfig } from '../config/load.js'
import { FLAG } from '../state/context.js'
import { dumps } from '../state/json.js'
import {
  checkGh,
  checkHarness,
  checkShepherd,
  checkStop,
  firstLine,
  type Check,
} from './preflight-checks.js'
import type { CliIo } from './run.js'

const PREFLIGHT_HELP = `Usage: supervisor preflight [--json]

Checks, in one command, what a supervisor loop needs before it starts. Each check is reported as
name, ok, and detail:

  config        The config file loads and validates ($SUPERVISOR_CONFIG, else .supervisor.json
                in the current directory)
  gh            "gh auth status" succeeds; the detail lists the token scopes when gh prints them
  pr-shepherd   "pr-shepherd --version" succeeds; the detail is the version
  hook-harness  "npx -y hook-harness@<eventWait.hookHarness> --version" succeeds; the detail is
                the version. Reported ok, with the detail "not configured", when the config file
                does not set eventWait (the loop then paces with wake-ups)
  stop          The stop switch is not set (see: supervisor stop --help); when it is set, the
                detail says since when and why, and the check is not ok

When the config does not load, config fails, hook-harness and stop are not ok (they need it), and
gh and pr-shepherd still run. Exit 0 when every check is ok, 1 otherwise.

Output is one line per check, "ok" or "FAIL", the name, and the detail. With --json it is one JSON
object, {"ok": <bool>, "checks": [{"name", "ok", "detail"}]}.

Options:
  --json            Print the JSON object instead of lines
  -h, --help        Show help
`

async function checkConfig(io: CliIo): Promise<{ check: Check; loaded?: LoadedConfig }> {
  try {
    const loaded = await loadConfig(io.env, process.cwd())
    return { check: { name: 'config', ok: true, detail: loaded.path }, loaded }
  } catch (error) {
    return { check: { name: 'config', ok: false, detail: firstLine((error as Error).message) } }
  }
}

export async function runPreflightCommand(args: string[], io: CliIo): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    io.stdout(PREFLIGHT_HELP)
    return 0
  }
  let json: boolean
  try {
    json = parseArgs({ args, options: { json: FLAG } }).values.json === true
  } catch (error) {
    io.stderr(`supervisor preflight: ${(error as Error).message}\n${PREFLIGHT_HELP}`)
    return 2
  }
  const { check, loaded } = await checkConfig(io)
  const checks = [
    check,
    await checkGh(io.runProcess),
    await checkShepherd(io.runProcess),
    await checkHarness(io.runProcess, loaded),
    await checkStop(loaded),
  ]
  const ok = checks.every((entry) => entry.ok)
  if (json) {
    io.stdout(`${dumps({ ok, checks: checks.map((entry) => ({ ...entry })) })}\n`)
  } else {
    for (const entry of checks) {
      io.stdout(`${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}: ${entry.detail}\n`)
    }
  }
  return ok ? 0 : 1
}
