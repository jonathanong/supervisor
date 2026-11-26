import { randomUUID } from 'node:crypto'
import { readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * A lock older than this is taken over even when its process seems to be alive, in case the pid
 * was reused after the owner died. A holder slower than this can lose an update, so no command
 * may hold the lock anywhere near this long.
 */
const STALE_MS = 10 * 60 * 1000
/** Breaking a lock takes milliseconds; a breaker file older than this was left by a dead process. */
const BREAKER_STALE_MS = 30 * 1000

export interface LockOptions {
  staleMs?: number
  breakerStaleMs?: number
  sleep?: () => Promise<unknown>
  isAlive?: (pid: number) => boolean
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function pause(): Promise<unknown> {
  return delay(10 + Math.random() * 20)
}

async function inspect(path: string): Promise<{ token: string; ageMs: number } | undefined> {
  try {
    const token = await readFile(path, 'utf8')
    return { token, ageMs: Date.now() - (await stat(path)).mtimeMs }
  } catch {
    return undefined
  }
}

/**
 * Remove a stale lock. Only one process breaks a lock at a time: it holds `<path>.break`, made
 * with exclusive create, and looks at the lock again while holding it. So a waiter that judged an
 * older lock stale cannot remove the fresh lock another process has taken since. A breaker file
 * that its process left behind is removed once it is older than `breakerStaleMs`. Returns false
 * when another process holds the breaker, so the caller waits before it looks again.
 */
async function breakStale(path: string, token: string, breakerStaleMs: number): Promise<boolean> {
  const breaker = `${path}.break`
  try {
    await writeFile(breaker, token, { flag: 'wx' })
  } catch {
    const other = await inspect(breaker)
    if (other !== undefined && other.ageMs > breakerStaleMs) {
      await rm(breaker, { force: true })
    }
    return false
  }
  try {
    if ((await inspect(path))?.token === token) {
      await rm(path, { force: true })
    }
  } finally {
    await rm(breaker, { force: true })
  }
  return true
}

/**
 * Run `fn` while holding an exclusive lock file. Node has no `flock`, so the lock is a file made
 * with exclusive create that holds the owner's pid. A waiter polls; it takes over a lock whose
 * process is gone or that is older than `staleMs`.
 */
export async function withLock<T>(
  path: string,
  fn: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const { staleMs = STALE_MS, sleep = pause, isAlive = processAlive } = options
  const breakerStaleMs = options.breakerStaleMs ?? BREAKER_STALE_MS
  const token = `${process.pid} ${randomUUID()}`
  for (;;) {
    try {
      await writeFile(path, token, { flag: 'wx' })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
    const held = await inspect(path)
    const pid = Number(held?.token.split(' ')[0])
    const stale = held !== undefined && ((pid > 0 && !isAlive(pid)) || held.ageMs > staleMs)
    if (!stale || !(await breakStale(path, held.token, breakerStaleMs))) {
      await sleep()
    }
  }
  try {
    return await fn()
  } finally {
    if ((await inspect(path))?.token === token) {
      await unlink(path)
    }
  }
}
