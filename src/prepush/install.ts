import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const HOOK_CONTENT = `#!/bin/sh
set -eu
exec supervisor prepush
`

export async function installPrePushHook(cwd: string, force = false): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', 'hooks/pre-push'], {
    cwd,
  })
  const rawPath = stdout.trim()
  const hookPath = isAbsolute(rawPath) ? rawPath : join(cwd, rawPath)

  let existing: string | null = null
  try {
    existing = await readFile(hookPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  if (existing !== null && !existing.includes('supervisor prepush') && !force) {
    throw new Error(`Existing pre-push hook at ${hookPath}; pass --force to overwrite`)
  }

  await mkdir(dirname(hookPath), { recursive: true })
  await writeFile(hookPath, HOOK_CONTENT, 'utf8')
  await chmod(hookPath, 0o755)
  return hookPath
}
