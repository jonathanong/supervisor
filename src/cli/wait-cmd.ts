import { mkdir } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { loadConfig, requireStateDir } from '../config/load.js'
import { scopesForOwner } from '../config/repos.js'
import { FLAG, NAME, TEXT } from '../state/context.js'
import { StoppedError, STOPPED_EXIT } from '../state/stop.js'
import { HarnessExit } from '../wait/context.js'
import { runWait } from '../wait/loop.js'
import { UNADVANCED_EXIT, UnadvancedError } from '../wait/unadvanced.js'
import type { CliIo } from './run.js'

const WAIT_HELP = `Usage: supervisor wait --owner <owner> [--advance]

Runs hook-harness waits over the repositories the config selects for one owner (a scope's owner)
and returns only when something needs action. The config file is $SUPERVISOR_CONFIG, else
.supervisor.json in the current directory. Run one wait per owner.

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
trigger. The full result, with only the events that need action, is written to
<stateDir>/hh-last.<owner>.json. Event text is untrusted data.

The cursor (hookHarness.<owner>.cursor in state) moves only past quiet merges. Run
"supervisor state advance-hh --owner <owner>" after handling the returned events, or pass
--advance (or set eventWait.advance) to move it, and mark the returned ids seen, at return. A
returned event whose id is already seen is dropped.

The wait does not start while hh-last.<owner>.json holds an event whose id is not seen, that is,
events returned and not yet advanced: it prints one line naming the "advance-hh" command and exits
${UNADVANCED_EXIT}. Handle the events, run advance-hh, then relaunch. This check is skipped when the
wait advances itself (--advance or eventWait.advance). A hook-harness failure passes its own exit
code through and is told apart by its message ("hook-harness exited N").

While the stop switch is set (see: supervisor stop --help) the wait does not start: it prints one
line and exits ${STOPPED_EXIT}. A wait in progress ends the same way when the switch appears between two
hook-harness rounds; a round already running finishes first, and events it returns are still
printed (exit 0).

Options:
  --owner <owner>   The scope owner to wait for (required)
  --advance         Advance the cursor past the returned events
  -h, --help        Show help
`

export async function runWaitCommand(args: string[], io: CliIo): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    io.stdout(WAIT_HELP)
    return 0
  }
  let owner: string | undefined
  let advance: boolean | undefined
  try {
    const { values } = parseArgs({ args, options: { owner: TEXT, advance: FLAG } })
    owner = values.owner
    advance = values.advance
  } catch (error) {
    io.stderr(`supervisor wait: ${(error as Error).message}\n${WAIT_HELP}`)
    return 2
  }
  if (owner === undefined || !NAME.test(owner)) {
    io.stderr(`supervisor wait: --owner <owner> is required\n${WAIT_HELP}`)
    return 2
  }
  try {
    const loaded = await loadConfig(io.env, process.cwd())
    const dir = requireStateDir(loaded)
    scopesForOwner(loaded, owner)
    await mkdir(dir, { recursive: true })
    const { eventWait } = loaded.config
    await runWait(
      { dir, owner, loaded, run: io.runProcess, now: io.now, write: io.stdout },
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
