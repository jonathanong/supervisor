import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface DenylistEntry {
  entryNumber: number
  regex: RegExp
}

export type DenylistLoadResult =
  | { status: 'loaded'; path: string; entries: DenylistEntry[] }
  | { status: 'missing'; path: string }

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function resolveDenylistPath(env: Record<string, string | undefined>): string {
  return env.SUPERVISOR_DENYLIST || join(homedir(), '.config', 'supervisor', 'denylist.txt')
}

export function parseDenylist(source: string): DenylistEntry[] {
  const entries: DenylistEntry[] = []
  let entryNumber = 0
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    entryNumber += 1
    const regexMatch = /^\/(.+)\/([gimsuvy]*)$/.exec(line)
    if (regexMatch) {
      const flags = regexMatch[2]!.replace(/[gy]/g, '')
      try {
        entries.push({ entryNumber, regex: new RegExp(regexMatch[1]!, flags) })
      } catch {
        // Never include the pattern text in error output.
        throw new Error(`Invalid regex at denylist entry #${entryNumber}`)
      }
    } else {
      entries.push({ entryNumber, regex: new RegExp(escapeRegex(line), 'i') })
    }
  }
  return entries
}

export async function loadDenylist(
  env: Record<string, string | undefined>,
): Promise<DenylistLoadResult> {
  const path = resolveDenylistPath(env)
  try {
    const source = await readFile(path, 'utf8')
    return { status: 'loaded', path, entries: parseDenylist(source) }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing', path }
    }
    throw err
  }
}
