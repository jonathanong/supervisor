import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FIELDS } from '../src/state/schema.js'
import { loadState, saveState } from '../src/state/store.js'
import { cleanupLoops, makeLoop, type Loop } from './helpers/loop.js'

const SCHEDULE = {
  id: 'job-1',
  registeredAt: '2026-01-01T00:00:00Z',
  cron: '0 */6 * * *',
  expiresAt: '2026-01-08T00:00:00Z',
}

const setSchedule = (loop: Loop, value: unknown) =>
  loop.cli(['state', 'set', 'schedule', '--json', JSON.stringify(value)])

/** The whole message a refused `schedule` write prints. */
const refused = (loop: Loop, problem: string) =>
  `${join(loop.stateDir, 'state.json')}: ${problem}; nothing was written\n`

describe('state.json schema', () => {
  afterEach(cleanupLoops)

  it('accepts a complete schedule on the first write to an absent file', async () => {
    const loop = await makeLoop()
    const set = await setSchedule(loop, SCHEDULE)
    expect(set.code).toBe(0)
    expect((await loop.state()).schedule).toEqual(SCHEDULE)
  })

  it('refuses a schedule that uses jobId, and writes nothing', async () => {
    const loop = await makeLoop()
    const set = await setSchedule(loop, { ...SCHEDULE, jobId: 'job-1' })
    expect(set.code).toBe(1)
    expect(set.stderr).toBe(refused(loop, 'schedule must NOT have additional properties (jobId)'))
    await expect(readFile(join(loop.stateDir, 'state.json'), 'utf8')).rejects.toThrow()
  })

  it('refuses a schedule missing a key, also when set key by key', async () => {
    const loop = await makeLoop()
    const { id: _id, ...rest } = SCHEDULE
    expect((await setSchedule(loop, rest)).stderr).toBe(
      refused(loop, "schedule must have required property 'id'"),
    )
    const keyByKey = await loop.cli(['state', 'set', 'schedule', 'id', '--json', '"job-1"'])
    expect(keyByKey.stderr).toBe(
      refused(loop, "schedule must have required property 'registeredAt'"),
    )
  })

  it('refuses a schedule with a bad timestamp or an empty string', async () => {
    const loop = await makeLoop()
    const stamp = await setSchedule(loop, { ...SCHEDULE, expiresAt: 'tomorrow' })
    expect(stamp.stderr).toContain(': schedule.expiresAt must match pattern "^')
    const empty = await setSchedule(loop, { ...SCHEDULE, id: '' })
    expect(empty.stderr).toBe(refused(loop, 'schedule.id must NOT have fewer than 1 characters'))
  })

  it('refuses a newly added unknown top-level field', async () => {
    const loop = await makeLoop()
    const state = await loadState(loop.stateDir)
    state.surprise = 1
    await expect(saveState(loop.stateDir, state)).rejects.toThrow(
      `${join(loop.stateDir, 'state.json')}: surprise is not a state field; nothing was written`,
    )
    delete state.surprise
    await saveState(loop.stateDir, state)
    // A state that was never loaded has no baseline, so every field in it is checked.
    await expect(saveState(loop.stateDir, { schedule: {} })).rejects.toThrow(
      "schedule must have required property 'id'",
    )
  })

  it('writes other fields while an old invalid schedule and unknown key are on disk', async () => {
    const loop = await makeLoop()
    await loop.seed({ schedule: { jobId: 'job-1' }, surprise: 1 })
    const show = await loop.cli(['state', 'show', 'schedule'])
    expect(show.code).toBe(0)
    expect(show.stdout).toContain('jobId')

    const write = await loop.cli(['state', 'set', 'lastSweepAt', '--json', '"t"'])
    expect(write.code).toBe(0)
    expect(await loop.state()).toEqual({
      schedule: { jobId: 'job-1' },
      surprise: 1,
      lastSweepAt: 't',
    })
    expect((await setSchedule(loop, { jobId: 'job-2' })).code).toBe(1)
  })

  it('repairs an invalid schedule with set, and removes it with remove', async () => {
    const loop = await makeLoop()
    await loop.seed({ schedule: { jobId: 'job-1' }, surprise: 1 })
    expect((await setSchedule(loop, SCHEDULE)).code).toBe(0)
    expect((await loop.state()).schedule).toEqual(SCHEDULE)

    await loop.seed({ schedule: { jobId: 'job-1' }, surprise: 1 })
    expect((await loop.cli(['state', 'remove', 'schedule'])).code).toBe(0)
    expect(await loop.state()).toEqual({ surprise: 1 })
  })

  it('derives the top-level kinds from the schema', () => {
    expect(FIELDS.schedule).toBe('object')
    expect(FIELDS.intake).toBe('array')
    expect(FIELDS.lastSweepAt).toBe('string')
    expect(Object.keys(FIELDS)).toHaveLength(18)
  })
})
