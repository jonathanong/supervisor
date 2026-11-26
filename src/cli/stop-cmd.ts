import { parseArgs } from 'node:util'
import { loadConfig, requireStateDir } from '../config/load.js'
import { FLAG, isUsageError, TEXT, UsageError } from '../state/context.js'
import { dumps } from '../state/json.js'
import { clearStop, readStop, setStop, STOPPED_EXIT } from '../state/stop.js'
import { timestamp } from '../state/store.js'
import type { CliIo } from './run.js'

const STOP_HELP = `Usage: supervisor stop [--reason <text>]
       supervisor stop --status
       supervisor resume

The stop switch is one file, <stateDir>/stop. While it exists the supervisor takes no action:
"supervisor wait" refuses to start and ends a wait in progress between two hook-harness rounds,
"supervisor state sweep-start" refuses, and the skills run "supervisor stop --status" before every
tick, every mutation, and every merge. A command that refuses prints one line and exits ${STOPPED_EXIT}. The
"supervisor state" subcommands that only record facts keep working, so a session can still write
down what it saw.

  stop [--reason <text>]   Create the file, recording the time and the reason as JSON; a second
                           stop replaces the first
  stop --status            Print whether the switch is set; exit 0 when it is not, ${STOPPED_EXIT} when it is
  resume                   Remove the file; exit 0 whether or not it was there

Each prints one line of JSON: {"stopped": <bool>, "at": <time>, "reason": <text>}; resume prints
the switch it removed as "was". None of them takes the state lock, so a stuck lock never blocks a
stop. Creating the file by hand (an empty file is enough) stops the supervisor too. The config
file is $SUPERVISOR_CONFIG, else .supervisor.json in the current directory.

Options:
  --reason <text>          Why the supervisor is stopped
  --status                 Report the switch instead of setting it
  -h, --help               Show help
`

async function stopOrStatus(args: string[], dir: string, io: CliIo): Promise<number> {
  const { values } = parseArgs({ args, options: { reason: TEXT, status: FLAG } })
  if (values.status !== true) {
    const stop = await setStop(dir, timestamp(io.now()), values.reason)
    io.stdout(`${dumps({ stopped: true, ...stop })}\n`)
    return 0
  }
  if (values.reason !== undefined) {
    throw new UsageError('--status takes no --reason')
  }
  const stop = await readStop(dir)
  io.stdout(`${dumps(stop === undefined ? { stopped: false } : { stopped: true, ...stop })}\n`)
  return stop === undefined ? 0 : STOPPED_EXIT
}

async function resume(args: string[], dir: string, io: CliIo): Promise<number> {
  parseArgs({ args, options: {} })
  const was = await clearStop(dir)
  io.stdout(`${dumps({ stopped: false, was: was === undefined ? null : { ...was } })}\n`)
  return 0
}

/** `supervisor stop` and `supervisor resume`: set, report, and clear the stop switch. */
export async function runStopCommand(
  name: 'stop' | 'resume',
  args: string[],
  io: CliIo,
): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    io.stdout(STOP_HELP)
    return 0
  }
  try {
    const dir = requireStateDir(await loadConfig(io.env, process.cwd()))
    return await (name === 'stop' ? stopOrStatus : resume)(args, dir, io)
  } catch (error) {
    if (isUsageError(error)) {
      io.stderr(`supervisor ${name}: ${(error as Error).message}\n${STOP_HELP}`)
      return 2
    }
    io.stderr(`${(error as Error).message}\n`)
    return 1
  }
}
