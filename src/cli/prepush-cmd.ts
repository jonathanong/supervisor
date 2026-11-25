import { loadDenylist } from '../prepush/denylist.js'
import { installPrePushHook } from '../prepush/install.js'
import { scanOutgoingCommits } from '../prepush/scan.js'
import type { CliIo } from './run.js'

const PREPUSH_HELP = `Usage:
  supervisor prepush [--range <a>..<b>] [--strict] [--dir <repo>]
  supervisor prepush install [--dir <repo>] [--force]
`

async function runInstall(args: string[], io: CliIo): Promise<number> {
  let dir = process.cwd()
  let force = false
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!
    if (arg === '--dir' && i + 1 < args.length) {
      dir = args[++i]!
    } else if (arg === '--force') {
      force = true
    } else {
      io.stderr(`Unknown or incomplete option: ${arg}\n${PREPUSH_HELP}`)
      return 2
    }
  }
  try {
    const hookPath = await installPrePushHook(dir, force)
    io.stdout(`Installed pre-push hook at ${hookPath}\n`)
    return 0
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`)
    return 2
  }
}

export async function runPrepushCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === 'install') {
    return await runInstall(args.slice(1), io)
  }

  let range: string | undefined
  let strict = false
  let dir = process.cwd()

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!
    if (arg === '--range' && i + 1 < args.length) {
      range = args[++i]
    } else if (arg === '--strict') {
      strict = true
    } else if (arg === '--dir' && i + 1 < args.length) {
      dir = args[++i]!
    } else {
      io.stderr(`Unknown or incomplete option: ${arg}\n${PREPUSH_HELP}`)
      return 2
    }
  }

  let loaded
  try {
    loaded = await loadDenylist(io.env)
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`)
    return 2
  }

  const missingDenylist = loaded.status === 'missing'
  if (missingDenylist) {
    io.stderr(`Warning: denylist file not found at ${loaded.path}\n`)
  }
  const entries = loaded.status === 'loaded' ? loaded.entries : []

  let matches
  try {
    matches = await scanOutgoingCommits(dir, entries, range)
  } catch (err) {
    io.stderr(`Failed to scan commits: ${(err as Error).message}\n`)
    return 2
  }

  for (const match of matches) {
    io.stderr(`${match.location}:${match.line}: matched ${match.rule}\n`)
  }

  if (matches.length > 0 || (missingDenylist && strict)) {
    return 1
  }
  io.stdout('Pre-push privacy check passed.\n')
  return 0
}
