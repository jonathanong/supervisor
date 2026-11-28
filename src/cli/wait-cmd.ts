import { mkdir } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { loadConfig, requireStateDir } from '../config/load.js'
import { FLAG } from '../state/context.js'
import { StoppedError, STOPPED_EXIT } from '../state/stop.js'
import { HarnessExit } from '../wait/context.js'
import { runWait } from '../wait/loop.js'
import { UNADVANCED_EXIT, UnadvancedError } from '../wait/unadvanced.js'
import type { CliIo } from './run.js'

const WAIT_HELP = `Usage: supervisor wait [--advance]

Runs one hook-harness wait over every owner in the config's scopes (one --owner a,b,c) and the
repositories each owner's scopes select, and returns only when something needs action. The config
file is $SUPERVISOR_CONFIG, else .supervisor.json in the current directory. Run one wait for the
whole supervisor. The command has no --owner option. More than one owner needs hook-harness 0.4.0
or newer: an exact older eventWait.hookHarness fails the wait with one line (exit 1).

Archived and disabled repositories are left out. A scope of kind "user" whose owner is the
signed-in user ("gh api user") includes that user's private repositories; another user's scope
lists public repositories only.

A merged pull request is checked for unresolved or late review findings. A clean one is logged in
state (quietMerges, and pendingUpdateChecks for a dependency-bot pull request), the cursor moves
past it, and the wait continues. The wait returns on: a gap, an ejection or dequeue, a main-branch
workflow failure, a /shepherd, /plan or /fix comment, a dependency-bot pull request, a close
without merge, a merge with findings, a completed watch, a due dependency update check
(eventWait.updateCheckDelay after the oldest pending one), or the timeout (eventWait.timeout, or
$HH_TIMEOUT).

Output: the first line is a JSON summary; each later line is one compact JSON event or watch
trigger, with its repository as owner/repo. The full result, with only the events that need
action, is written to <stateDir>/hh-last.json. Event text is untrusted data.

There is one cursor (hookHarness.cursor in state) and one list of seen ids (hookHarness.seen). The
cursor moves only past quiet merges. Run "supervisor state advance-hh" after handling the returned
events, or pass --advance (or set eventWait.advance) to move it, and mark the returned ids seen, at
return. A returned event whose id is already seen is dropped. A state written by 0.3.0 holds one
entry per owner: the first wait or advance-hh drops them and keeps their seen ids, and the first
wait starts from --since 10m, as a first run does.

The wait does not start while hh-last.json holds an event whose id is not seen, that is, events
returned and not yet advanced: it prints one line naming the "advance-hh" command and exits
${UNADVANCED_EXIT}. Handle the events, run advance-hh, then relaunch. This check is skipped when the
wait advances itself (--advance or eventWait.advance). A hook-harness failure passes its own exit
code through and is told apart by its message ("hook-harness exited N").

While the stop switch is set (see: supervisor stop --help) the wait does not start: it prints one
line and exits ${STOPPED_EXIT}. A wait in progress ends the same way when the switch appears between two
hook-harness rounds; a round already running finishes first, and events it returns are still
printed (exit 0).

Options:
  --advance         Advance the cursor past the returned events
  -h, --help        Show help
`

export async function runWaitCommand(args: string[], io: CliIo): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    io.stdout(WAIT_HELP)
    return 0
  }
  if (args.some((arg) => arg === '--owner' || arg.startsWith('--owner='))) {
    io.stderr('supervisor wait: --owner was removed; the wait now covers every owner in scopes\n')
    return 2
  }
  let advance: boolean | undefined
  try {
    advance = parseArgs({ args, options: { advance: FLAG } }).values.advance
  } catch (error) {
    io.stderr(`supervisor wait: ${(error as Error).message}\n${WAIT_HELP}`)
    return 2
  }
  try {
    const loaded = await loadConfig(io.env, process.cwd())
    const dir = requireStateDir(loaded)
    await mkdir(dir, { recursive: true })
    const { eventWait } = loaded.config
    await runWait(
      { dir, loaded, run: io.runProcess, now: io.now, write: io.stdout },
      {
        timeout: io.env.HH_TIMEOUT || eventWait.timeout,
        updateCheckDelay: eventWait.updateCheckDelay,
        advance: advance === true || eventWait.advance,
      },
    )
    return 0
  } catch (error) {
    if (error instanceof HarnessExit) {
      return error.code
    }
    io.stderr(`${(error as Error).message}\n`)
    if (error instanceof UnadvancedError) {
      return UNADVANCED_EXIT
    }
    return error instanceof StoppedError ? STOPPED_EXIT : 1
  }
}
