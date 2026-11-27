import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FIELDS } from '../src/state/store.js'
import { cleanupLoops, makeLoop } from './helpers/loop.js'

const SCHEDULE = {
  id: 'job-1',
  registeredAt: '2026-01-01T00:00:00Z',
  cron: '0 */6 * * *',
  expiresAt: '2026-01-08T00:00:00Z',
}

describe('state.json schema', () => {
  afterEach(cleanupLoops)

  it('accepts a complete schedule', async () => {
    const loop = await makeLoop()
    const set = await loop.cli(['state', 'set', 'schedule', '--json', JSON.stringify(SCHEDULE)])
    expect(set.code).toBe(0)
    expect((await loop.state()).schedule).toEqual(SCHEDULE)
  })

  it('refuses a schedule that uses jobId, and writes nothing', async () => {
    const loop = await makeLoop()
    const bad = { ...SCHEDULE, jobId: 'job-1' }
    const set = await loop.cli(['state', 'set', 'schedule', '--json', JSON.stringify(bad)])
    expect(set.code).toBe(1)
    expect(set.stderr).toBe('state.json: schedule must NOT have additional properties (jobId)\n')
    await expect(readFile(join(loop.stateDir, 'state.json'), 'utf8')).rejects.toThrow()
  })

  it('refuses a schedule missing a key', async () => {
    const loop = await makeLoop()
    const { id: _id, ...rest } = SCHEDULE
    const set = await loop.cli(['state', 'set', 'schedule', '--json', JSON.stringify(rest)])
    expect(set.code).toBe(1)
    expect(set.stderr).toBe("state.json: schedule must have required property 'id'\n")
    const keyByKey = await loop.cli(['state', 'set', 'schedule', 'id', '--json', '"job-1"'])
    expect(keyByKey.stderr).toBe(
      "state.json: schedule must have required property 'registeredAt'\n",
    )
  })

  it('refuses a schedule with a bad timestamp or an empty string', async () => {
    const loop = await makeLoop()
    const stamp = { ...SCHEDULE, expiresAt: 'tomorrow' }
    const set = await loop.cli(['state', 'set', 'schedule', '--json', JSON.stringify(stamp)])
    expect(set.stderr).toBe(
      'state.json: schedule.expiresAt must match pattern ' +
        '"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$"\n',
    )
    const empty = await loop.cli([
      'state',
      'set',
      'schedule',
      '--json',
      JSON.stringify({ ...SCHEDULE, id: '' }),
    ])
    expect(empty.stderr).toBe('state.json: schedule.id must NOT have fewer than 1 characters\n')
  })

  it('refuses an unknown top-level field in a seeded file when any write happens', async () => {
    const loop = await makeLoop()
    await loop.seed({ surprise: 1 })
    const set = await loop.cli(['state', 'set', 'lastSweepAt', '--json', '"t"'])
    expect(set.code).toBe(1)
    expect(set.stderr).toBe('state.json: must NOT have additional properties (surprise)\n')
  })

  it('reads an invalid file, and repairs it with set or remove', async () => {
    const loop = await makeLoop()
    await loop.seed({ schedule: { jobId: 'job-1' } })
    const show = await loop.cli(['state', 'show', 'schedule'])
    expect(show.code).toBe(0)
    expect(show.stdout).toContain('jobId')

    const blocked = await loop.cli(['state', 'set', 'lastSweepAt', '--json', '"t"'])
    expect(blocked.stderr).toBe("state.json: schedule must have required property 'id'\n")

    const repaired = await loop.cli([
      'state',
      'set',
      'schedule',
      '--json',
      JSON.stringify(SCHEDULE),
    ])
    expect(repaired.code).toBe(0)
    expect((await loop.state()).schedule).toEqual(SCHEDULE)

    await loop.seed({ schedule: { jobId: 'job-1' } })
    const removed = await loop.cli(['state', 'remove', 'schedule'])
    expect(removed.code).toBe(0)
    expect(await loop.state()).toEqual({})
  })

  it('derives the top-level kinds from the schema', () => {
    expect(FIELDS.schedule).toBe('object')
    expect(FIELDS.intake).toBe('array')
    expect(FIELDS.lastSweepAt).toBe('string')
    expect(Object.keys(FIELDS)).toHaveLength(18)
  })
})
