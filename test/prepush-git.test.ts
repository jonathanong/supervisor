import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli, type CliIo } from '../src/cli/run.js'
import { installPrePushHook } from '../src/prepush/install.js'
import { resolveScanRange } from '../src/prepush/scan.js'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

async function makeTempDir(prefix = 'supervisor-git-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

async function initRepo(dir: string): Promise<void> {
  await git(['init', '-b', 'main'], dir)
  await git(['config', 'user.name', 'Test User'], dir)
  await git(['config', 'user.email', 'noreply@example.com'], dir)
}

function createTestIo(env: Record<string, string | undefined> = {}) {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = {
    env,
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    startMcp: vi.fn(async () => undefined),
    runProcess: vi.fn(),
    shepherdStatus: vi.fn(),
    now: () => new Date(0),
  }
  return { io, stdout: () => out.join(''), stderr: () => err.join('') }
}

describe('supervisor prepush git scanning and hook install', () => {
  afterEach(async () => {
    while (tempDirs.length > 0) await rm(tempDirs.pop()!, { recursive: true, force: true })
  })

  it('scans outgoing added lines, deletions, and commit messages without leaking denylist terms', async () => {
    const repo = await makeTempDir()
    const denyDir = await makeTempDir()
    const denylistPath = join(denyDir, 'denylist.txt')
    await writeFile(denylistPath, '# private terms\nforbidden-corp\n/vault-[0-9]+/\n', 'utf8')
    await initRepo(repo)

    await writeFile(join(repo, 'keep.txt'), 'clean line\n', 'utf8')
    await writeFile(join(repo, 'drop.txt'), 'will be deleted\n', 'utf8')
    await git(['add', 'keep.txt', 'drop.txt'], repo)
    await git(['commit', '-m', 'Initial clean commit'], repo)
    const baseSha = await git(['rev-parse', 'HEAD'], repo)

    const cleanIo = createTestIo({ SUPERVISOR_DENYLIST: denylistPath })
    expect(await runCli(['prepush', '--dir', repo], cleanIo.io)).toBe(0)
    expect(cleanIo.stdout()).toContain('passed')

    await unlink(join(repo, 'drop.txt'))
    await writeFile(
      join(repo, 'notes.md'),
      'ok\nmentions forbidden-corp here\nalice@example.com\n',
      'utf8',
    )
    await git(['add', '-A'], repo)
    await git(['commit', '-m', 'Update notes for vault-99'], repo)

    const leakIo = createTestIo({ SUPERVISOR_DENYLIST: denylistPath })
    expect(await runCli(['prepush', '--dir', repo, '--range', `${baseSha}..HEAD`], leakIo.io)).toBe(
      1,
    )
    expect(leakIo.stderr()).toContain('notes.md:2: matched denylist entry #1')
    expect(leakIo.stderr()).toContain('notes.md:3: matched built-in email')
    expect(leakIo.stderr()).toContain('message:1: matched denylist entry #2')
    expect(leakIo.stderr()).not.toContain('forbidden-corp')
    expect(leakIo.stderr()).not.toContain('vault-99')
  })

  it('handles missing denylist (warn vs --strict), remote ranges, and error exit codes', async () => {
    const bare = await makeTempDir('supervisor-bare-')
    await git(['init', '--bare', '-b', 'main'], bare)
    const repo = await makeTempDir()
    await initRepo(repo)
    await git(['remote', 'add', 'origin', bare], repo)

    await writeFile(join(repo, 'a.txt'), 'hello\n', 'utf8')
    await git(['add', 'a.txt'], repo)
    await git(['commit', '-m', 'Base'], repo)
    await git(['push', '-u', 'origin', 'main'], repo)

    expect((await resolveScanRange(repo)).logRange).toBe('@{upstream}..HEAD')
    await git(['checkout', '-b', 'feat'], repo)
    expect((await resolveScanRange(repo)).logRange).toBe('origin/main..HEAD')

    const missingPath = join(bare, 'missing-denylist.txt')
    const warnIo = createTestIo({ SUPERVISOR_DENYLIST: missingPath })
    expect(await runCli(['prepush', '--dir', repo], warnIo.io)).toBe(0)
    expect(warnIo.stderr()).toContain('Warning: denylist file not found')

    const strictIo = createTestIo({ SUPERVISOR_DENYLIST: missingPath })
    expect(await runCli(['prepush', '--dir', repo, '--strict'], strictIo.io)).toBe(1)

    const badRegexPath = join(bare, 'bad-deny.txt')
    await writeFile(badRegexPath, '/[unclosed/\n', 'utf8')
    const badRegexIo = createTestIo({ SUPERVISOR_DENYLIST: badRegexPath })
    expect(await runCli(['prepush', '--dir', repo], badRegexIo.io)).toBe(2)

    const badRangeIo = createTestIo({ SUPERVISOR_DENYLIST: missingPath })
    expect(await runCli(['prepush', '--dir', repo, '--range', 'nope..HEAD'], badRangeIo.io)).toBe(2)

    const badOptIo = createTestIo()
    expect(await runCli(['prepush', '--bogus'], badOptIo.io)).toBe(2)
  })

  it('installs executable pre-push hook in repos and linked worktrees and guards overwrites', async () => {
    const repo = await makeTempDir()
    await initRepo(repo)
    await writeFile(join(repo, 'README.md'), 'init\n', 'utf8')
    await git(['add', 'README.md'], repo)
    await git(['commit', '-m', 'Init'], repo)

    const io1 = createTestIo()
    expect(await runCli(['prepush', 'install', '--dir', repo], io1.io)).toBe(0)
    const hookPath = join(repo, '.git/hooks/pre-push')
    const content = await readFile(hookPath, 'utf8')
    expect(content).toContain('exec supervisor prepush')
    expect((await stat(hookPath)).mode & 0o111).toBeGreaterThan(0)

    // Idempotent re-install over existing supervisor hook succeeds without --force
    expect(await runCli(['prepush', 'install', '--dir', repo], createTestIo().io)).toBe(0)

    // Custom hook refused without --force, replaced with --force
    await writeFile(hookPath, '#!/bin/sh\necho custom\n', 'utf8')
    expect(await runCli(['prepush', 'install', '--dir', repo], createTestIo().io)).toBe(2)
    expect(await runCli(['prepush', 'install', '--dir', repo, '--force'], createTestIo().io)).toBe(
      0,
    )

    // Linked worktree resolves absolute git-path cleanly
    const wt = join(await makeTempDir('supervisor-wt-'), 'linked')
    await git(['worktree', 'add', '-b', 'wt-branch', wt], repo)
    const installedPath = await installPrePushHook(wt)
    expect(installedPath).toContain('hooks/pre-push')

    // Non-ENOENT error (directory at hookPath) rethrows and install usage error exits 2
    expect(await runCli(['prepush', 'install', '--bogus'], createTestIo().io)).toBe(2)
    await rm(hookPath)
    await import('node:fs/promises').then((fs) => fs.mkdir(hookPath))
    await expect(installPrePushHook(repo)).rejects.toThrow()
  })
})
