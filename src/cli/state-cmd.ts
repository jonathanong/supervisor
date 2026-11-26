import { DEFAULT_PROMPT_HISTORY } from '../config/defaults.js'
import { loadConfig, requireStateDir } from '../config/load.js'
import { advanceHookHarness, lateReview, updateCheck } from '../state/commands-external.js'
import { appendValue, removeValue, setValue } from '../state/commands-path.js'
import {
  annotateRoute,
  reviewed,
  route,
  scheduledPromptNext,
  scheduledPromptRecord,
  shepherd,
  show,
  sweepDone,
} from '../state/commands-records.js'
import { watch } from '../state/commands-watch.js'
import { UsageError, type StateContext } from '../state/context.js'
import { dumps } from '../state/json.js'
import { FIELDS, timestamp, withStateLock } from '../state/store.js'
import type { CliIo } from './run.js'

const FIELD_NAMES = Object.keys(FIELDS)
const FIELD_LINES = [0, 6, 12]
  .map((start) => `  ${FIELD_NAMES.slice(start, start + 6).join(', ')}`)
  .join(',\n')

const STATE_HELP = `Usage: supervisor state <subcommand> [options]

Typed, locked, atomic updates to <stateDir>/state.json. The config file is $SUPERVISOR_CONFIG,
else .supervisor.json in the current directory. Each subcommand holds the state lock for its whole
read-modify-write, checks the shape of the fields it touches, and replaces the file atomically.

Subcommands:
  show [key]                              Print one key, or the top-level keys
  set <path> --json <value>               Set a dotted path under a known field to a JSON value
  append <path> --json <value> [--keep <n>]
                                          Append a JSON value to the list at a dotted path;
                                          --keep keeps only the newest n entries
  remove <path>                           Remove the key at a dotted path
  sweep-done                              Set lastSweepAt to now
  advance-hh --owner <owner>              Store the cursor and seen ids from hh-last.<owner>.json
                                          under hookHarness.<owner>
  route --what <text> --to <text> [--evidence <text>] [--issue <text>] [--note <text>]
                                          Record where an item was routed
  annotate-route --match <text> --note <text> [--issue <text>]
                                          Annotate the one routed item whose "what" contains <text>
  sp-record --prompt <name> --run-id <id> --outcome <text> --next <name> [--pr <ref>]
                                          Record a scheduled-prompt run and the next prompt
  sp-next --next <name>                   Set the next scheduled prompt
  shepherd --pr <owner/repo#N> [--by <who>] [--head <sha>] [--category <name>]
                                          Record an in-flight shepherd (--by defaults to
                                          "loop subagent")
  shepherd --pr <owner/repo#N> --remove   Remove an in-flight shepherd
  reviewed --file <path>                  Add harvested comment ids from a
                                          {"<owner>/<repo>": [ids]} JSON file
  watch add --id <id> --notify <session> --pr <owner/repo#N> [--pr ...] [--note <text>]
                                          Add a merge watch; supervisor wait reports it when
                                          every pull request has merged
  watch list | watch ack --id <id> | watch remove --id <id>
                                          List the watches, acknowledge one, or remove one
  late-review <owner/repo#N>...           Report unresolved threads and late reviews for merged
                                          pull requests (takes no lock; exits 1 on any error)
  update-check-script --repo <name>[:<ecosystem>,...] [--repo ...] [--owner <owner>] [--dry]
                                          Print the dependency update-check browser script
                                          (takes no lock; --owner defaults to the only scope owner)

Fields (the first key of every <path>):
${FIELD_LINES}

Keys that name a repository are <owner>/<repo>, for example
  supervisor state set lateReview.example-org/example-repo.scannedThrough --json '"2026-01-01T00:00:00Z"'

Options:
  -h, --help                              Show help
`

async function dispatch(name: string, args: string[], ctx: StateContext): Promise<number> {
  const locked = (fn: (args: string[], ctx: StateContext) => Promise<void>) =>
    withStateLock(ctx.dir, async () => {
      await fn(args, ctx)
      return 0
    })
  switch (name) {
    case 'show':
      return await locked(show)
    case 'set':
      return await locked(setValue)
    case 'append':
      return await locked(appendValue)
    case 'remove':
      return await locked(removeValue)
    case 'sweep-done':
      return await locked(sweepDone)
    case 'advance-hh':
      return await locked(advanceHookHarness)
    case 'route':
      return await locked(route)
    case 'annotate-route':
      return await locked(annotateRoute)
    case 'sp-record':
      return await locked(scheduledPromptRecord)
    case 'sp-next':
      return await locked(scheduledPromptNext)
    case 'shepherd':
      return await locked(shepherd)
    case 'reviewed':
      return await locked(reviewed)
    case 'watch':
      return await locked(watch)
    case 'late-review':
      return await lateReview(args, ctx)
    case 'update-check-script':
      updateCheck(args, ctx)
      return 0
    default:
      throw new UsageError(`unknown subcommand: ${name}`)
  }
}

function isUsageError(error: unknown): boolean {
  const code = (error as { code?: unknown }).code
  return (
    error instanceof UsageError || (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS'))
  )
}

export async function runStateCommand(args: string[], io: CliIo): Promise<number> {
  const [name, ...rest] = args
  if (name === undefined) {
    io.stderr(STATE_HELP)
    return 2
  }
  if ([name, rest[0]].some((arg) => arg === '--help' || arg === '-h')) {
    io.stdout(STATE_HELP)
    return 0
  }
  try {
    const loaded = await loadConfig(io.env, process.cwd())
    return await dispatch(name, rest, {
      dir: requireStateDir(loaded),
      history: loaded.config.scheduledPrompts?.history ?? DEFAULT_PROMPT_HISTORY,
      owners: [...new Set(loaded.config.scopes.map((scope) => scope.owner))],
      run: io.runProcess,
      now: () => timestamp(io.now()),
      print: (value) => {
        io.stdout(`${dumps(value)}\n`)
      },
      write: io.stdout,
    })
  } catch (error) {
    if (isUsageError(error)) {
      io.stderr(`supervisor state: ${(error as Error).message}\n${STATE_HELP}`)
      return 2
    }
    io.stderr(`${(error as Error).message}\n`)
    return 1
  }
}
