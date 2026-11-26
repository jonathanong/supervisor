import { randomUUID } from 'node:crypto'
import { link, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

/** A lock older than this is taken over even when its process still seems to be alive. */
const STALE_MS = 10 * 60 * 1000

export interface LockOptions {
  staleMs?: number
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
 * Remove a stale lock. The file is moved aside first, so two processes cannot both remove it; if
 * the moved file is not the one that was judged stale, a live lock was taken and is put back.
 */
async function breakStale(path: string, token: string): Promise<void> {
  const aside = `${path}.${randomUUID()}`
  try {
    await rename(path, aside)
  } catch {
    return
  }
  if ((await readFile(aside, 'utf8')) !== token) {
    await link(aside, path)
  }
  await unlink(aside)
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
    if (held !== undefined && ((pid > 0 && !isAlive(pid)) || held.ageMs > staleMs)) {
      await breakStale(path, held.token)
    } else {
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
