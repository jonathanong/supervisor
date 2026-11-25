import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DenylistEntry } from './denylist.js'
import { scanLine, type PrivacyMatch } from './patterns.js'

const execFileAsync = promisify(execFile)
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

async function refExists(ref: string, cwd: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', '--quiet', ref], cwd)
    return true
  } catch {
    return false
  }
}

export async function resolveScanRange(
  cwd: string,
  explicitRange?: string,
): Promise<{ diffArgs: string[]; logRange: string }> {
  if (explicitRange) {
    return { diffArgs: [explicitRange], logRange: explicitRange }
  }
  if (await refExists('@{upstream}', cwd)) {
    return { diffArgs: ['@{upstream}..HEAD'], logRange: '@{upstream}..HEAD' }
  }
  if (await refExists('origin/main', cwd)) {
    return { diffArgs: ['origin/main..HEAD'], logRange: 'origin/main..HEAD' }
  }
  return { diffArgs: [EMPTY_TREE_SHA, 'HEAD'], logRange: 'HEAD' }
}

export function scanUnifiedDiff(diffText: string, entries: DenylistEntry[]): PrivacyMatch[] {
  const matches: PrivacyMatch[] = []
  let currentFile: string | null = null
  let currentLine = 0

  for (const rawLine of diffText.split('\n')) {
    if (rawLine.startsWith('+++ ')) {
      const target = rawLine.slice(4)
      currentFile = target === '/dev/null' ? null : target.replace(/^b\//, '')
      continue
    }
    const hunk = /^@@ [^@]+ \+(\d+)/.exec(rawLine)
    if (hunk) {
      currentLine = Number(hunk[1])
      continue
    }
    if (currentFile && rawLine.startsWith('+')) {
      matches.push(...scanLine(rawLine.slice(1), currentFile, currentLine, entries))
      currentLine += 1
    }
  }

  return matches
}

export function scanCommitLog(logText: string, entries: DenylistEntry[]): PrivacyMatch[] {
  const matches: PrivacyMatch[] = []
  for (const record of logText.split('\x1e')) {
    const trimmed = record.trimStart()
    if (trimmed.length === 0) continue
    const sep = trimmed.indexOf('\x00')
    const sha = trimmed.slice(0, sep)
    const message = trimmed.slice(sep + 1)
    const lines = message.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      matches.push(...scanLine(lines[i]!, `commit ${sha} message`, i + 1, entries))
    }
  }
  return matches
}

export async function scanOutgoingCommits(
  cwd: string,
  entries: DenylistEntry[],
  explicitRange?: string,
): Promise<PrivacyMatch[]> {
  const { diffArgs, logRange } = await resolveScanRange(cwd, explicitRange)
  const diffText = await git(['diff', '-U0', '--no-color', ...diffArgs], cwd)
  const logText = await git(['log', '--format=%h%x00%B%x1e', logRange], cwd)
  return [...scanUnifiedDiff(diffText, entries), ...scanCommitLog(logText, entries)]
}
