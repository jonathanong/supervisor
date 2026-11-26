import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { rmSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withLock } from '../src/state/lock.js'
import { cleanupLoops, makeLoop } from './helpers/loop.js'

let dir: string
let lock: string

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''])
  await once(child, 'exit')
  return child.pid!
}

describe('state lock', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'supervisor-lock-'))
    lock = join(dir, 'state.lock')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await cleanupLoops()
  })

  it('runs contending holders one at a time and removes the lock afterwards', async () => {
    const order: string[] = []
    let waiting = 0
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    // The first holder keeps the lock until both contenders have found it taken and slept.
    const sleep = async () => {
      waiting += 1
      if (waiting >= 2) release()
      await new Promise((resolve) => setImmediate(resolve))
    }
    const hold = (name: string) =>
      withLock(
        lock,
        async () => {
          order.push(`${name}:start`)
          await released
          order.push(`${name}:end`)
          return name
        },
        { sleep },
      )
    expect(await Promise.all([hold('a'), hold('b'), hold('c')])).toEqual(['a', 'b', 'c'])
    expect(order).toHaveLength(6)
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i + 1]).toBe(order[i]!.replace('start', 'end'))
    }
    expect(await readdir(dir)).toEqual([])
  })

  it('releases the lock when the holder throws, and fails when the lock cannot be made', async () => {
    await expect(
      withLock(lock, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await readdir(dir)).toEqual([])
    await expect(withLock(join(dir, 'missing', 'x.lock'), async () => 1)).rejects.toThrow(/ENOENT/)
  })

  it('takes over a lock whose process is gone', async () => {
    await writeFile(lock, `${await deadPid()} stale-token`)
    expect(await withLock(lock, async () => 'ran')).toBe('ran')
    expect(await readdir(dir)).toEqual([])
  })

  it('takes over a lock older than the stale age even when its process is alive', async () => {
    await writeFile(lock, `${process.pid} old-token`)
    expect(await withLock(lock, async () => 'ran', { staleMs: -1 })).toBe('ran')
  })

  it('waits on an unreadable lock, and on one without a pid, until it is released', async () => {
    await mkdir(lock)
    let sleeps = 0
    const sleep = async () => {
      sleeps += 1
      await (sleeps === 1 ? rmdir(lock).then(() => writeFile(lock, 'no-pid')) : rm(lock))
    }
    expect(await withLock(lock, async () => 'ran', { sleep })).toBe('ran')
    expect(sleeps).toBe(2)
  })

  it('leaves a fresh lock that replaced the stale one before it could be removed', async () => {
    await writeFile(lock, '424242 stale-token')
    let first = true
    const isAlive = () => {
      if (!first) return true
      first = false
      writeFileSync(lock, '424243 live-token')
      return false
    }
    const sleep = async () => {
      expect(await readFile(lock, 'utf8')).toBe('424243 live-token')
      await rm(lock)
    }
    expect(await withLock(lock, async () => 'ran', { isAlive, sleep })).toBe('ran')
    expect(await readdir(dir)).toEqual([])
  })

  it('lets only one waiter break a stale lock, so a fresh lock is never removed', async () => {
    await writeFile(lock, '424242 stale-token')
    await writeFile(`${lock}.break`, 'another breaker')
    let sleeps = 0
    const sleep = async () => {
      sleeps += 1
      // The other breaker finishes: it removed the stale lock and a third process took a fresh one.
      if (sleeps === 1) {
        await writeFile(lock, `${process.pid} fresh-token`)
        await rm(`${lock}.break`)
      } else {
        expect(await readFile(lock, 'utf8')).toBe(`${process.pid} fresh-token`)
        await rm(lock)
      }
    }
    const isAlive = (pid: number) => pid === process.pid
    expect(await withLock(lock, async () => 'ran', { isAlive, sleep })).toBe('ran')
    expect(sleeps).toBe(2)
    expect(await readdir(dir)).toEqual([])
  })

  it('removes a breaker file that a dead process left behind', async () => {
    await writeFile(lock, '424242 stale-token')
    await writeFile(`${lock}.break`, 'left behind')
    const isAlive = () => false
    expect(await withLock(lock, async () => 'ran', { isAlive, breakerStaleMs: -1 })).toBe('ran')
    expect(await readdir(dir)).toEqual([])
  })

  it('gives way when another process removes the stale lock first', async () => {
    await writeFile(lock, '424242 stale-token')
    const isAlive = () => {
      rmSync(lock)
      return false
    }
    expect(await withLock(lock, async () => 'ran', { isAlive })).toBe('ran')
  })

  it('leaves a lock that was taken over while it ran', async () => {
    await withLock(lock, async () => {
      await writeFile(lock, '424242 other-token')
    })
    expect(await readFile(lock, 'utf8')).toBe('424242 other-token')
  })

  it('keeps every update when many state commands run at once', async () => {
    const loop = await makeLoop()
    const writes = Array.from({ length: 12 }, (_, i) =>
      loop.cli(['state', 'append', 'intake', '--json', String(i)]),
    )
    expect((await Promise.all(writes)).map((result) => result.code)).toEqual(Array(12).fill(0))
    const { intake } = await loop.state()
    expect([...intake].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i))
    expect((await readdir(loop.stateDir)).sort()).toEqual(['state.json'])
  })
})
