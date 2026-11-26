import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop } from './helpers/loop.js'

describe('supervisor state set, append, remove and show', () => {
  afterEach(cleanupLoops)

  it('sets nested paths, creating parents, and writes a private indented file', async () => {
    const loop = await makeLoop()
    const key = 'lateReview.example-org/example-repo.scannedThrough'
    const set = await loop.cli(['state', 'set', key, '--json', '"2026-01-01T00:00:00Z"'])
    expect(set).toEqual({ code: 0, stdout: `{"${key}": "2026-01-01T00:00:00Z"}\n`, stderr: '' })
    await loop.cli(['state', 'set', 'schedule', '--json', '{"id":"job-1","n":[1,2]}'])
    expect((await loop.cli(['state', 'set', 'lastSweepAt', '--json=""'])).stdout).toBe(
      '{"lastSweepAt": ""}\n',
    )

    const path = join(loop.stateDir, 'state.json')
    expect(await readFile(path, 'utf8')).toBe(
      '{\n  "lateReview": {\n    "example-org/example-repo": {\n' +
        '      "scannedThrough": "2026-01-01T00:00:00Z"\n    }\n  },\n' +
        '  "schedule": {\n    "id": "job-1",\n    "n": [\n      1,\n      2\n    ]\n  },\n' +
        '  "lastSweepAt": ""\n}\n',
    )
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('prints ASCII JSON with spaced separators, and show prints indented JSON', async () => {
    const loop = await makeLoop()
    const set = await loop.cli(['state', 'set', 'escalations.k', '--json', '{"é":["ü",1,null]}'])
    expect(set.stdout).toBe('{"escalations.k": {"\\u00e9": ["\\u00fc", 1, null]}}\n')
    expect(await readFile(join(loop.stateDir, 'state.json'), 'utf8')).toContain('"\\u00e9"')
    await loop.cli(['state', 'set', 'lastSweepAt', '--json', '"t"'])

    expect((await loop.cli(['state', 'show'])).stdout).toBe(
      '[\n  "escalations",\n  "lastSweepAt"\n]\n',
    )
    expect((await loop.cli(['state', 'show', 'lastSweepAt'])).stdout).toBe('"t"\n')
    expect((await loop.cli(['state', 'show', 'constructor'])).stdout).toBe('null\n')
    expect((await loop.cli(['state', 'show', 'a', 'b'])).code).toBe(2)
  })

  it('checks the shape of a top-level field and of every parent on the path', async () => {
    const loop = await makeLoop()
    const wrong = await loop.cli(['state', 'set', 'intake', '--json', '{}'])
    expect(wrong).toMatchObject({
      code: 1,
      stderr: 'state.json: intake must be array, got object\n',
    })
    expect((await loop.cli(['state', 'set', 'lastSweepAt', '--json', 'null'])).stderr).toBe(
      'state.json: lastSweepAt must be string, got null\n',
    )
    expect((await loop.cli(['state', 'set', 'intake.x', '--json', '1'])).stderr).toBe(
      'state.json: intake must be object, got array\n',
    )
    await loop.seed({ shepherds: { a: 'text' } })
    expect((await loop.cli(['state', 'set', 'shepherds.a.b', '--json', '1'])).stderr).toBe(
      'state.json: shepherds.a must be object, got string\n',
    )
    expect((await loop.cli(['state', 'set', 'lastSweepAt', '--json', '{oops'])).stderr).toMatch(
      /^--json: /,
    )
  })

  it('rejects a path outside the known fields or with an empty key', async () => {
    const loop = await makeLoop()
    for (const path of ['unknown.key', 'intake..x', 'toString']) {
      const result = await loop.cli(['state', 'set', path, '--json', '1'])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(`'${path}' must start with one of commandsThrough, `)
    }
    expect((await loop.cli(['state', 'set', '--json', '1'])).code).toBe(2)
    expect((await loop.cli(['state', 'set', 'intake', 'extra', '--json', '1'])).code).toBe(2)
    expect((await loop.cli(['state', 'set', 'intake'])).stderr).toContain('--json is required')
  })

  it('stores a key named __proto__ as data without touching the prototype', async () => {
    const loop = await makeLoop()
    await loop.cli(['state', 'set', 'escalations.__proto__.polluted', '--json', 'true'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    const raw = await readFile(join(loop.stateDir, 'state.json'), 'utf8')
    expect(raw).toContain('"__proto__": {\n      "polluted": true')
  })

  it('appends to a list, creating it, and trims to --keep', async () => {
    const loop = await makeLoop()
    expect(
      (await loop.cli(['state', 'append', 'handledFailures.runs', '--json', '1'])).stdout,
    ).toBe('{"handledFailures.runs": 1}\n')
    await loop.cli(['state', 'append', 'handledFailures.runs', '--json', '2'])
    const kept = await loop.cli([
      'state',
      'append',
      'handledFailures.runs',
      '--json',
      '3',
      '--keep',
      '2',
    ])
    expect(kept.stdout).toBe('{"handledFailures.runs": 2}\n')
    expect((await loop.state()).handledFailures.runs).toEqual([2, 3])
    await loop.cli(['state', 'append', 'handledFailures.runs', '--json', '4', '--keep', '0'])
    expect((await loop.state()).handledFailures.runs).toEqual([2, 3, 4])

    expect((await loop.cli(['state', 'append', 'intake', '--json', '1', '--keep', 'x'])).code).toBe(
      2,
    )
    await loop.cli(['state', 'set', 'schedule.id', '--json', '"job"'])
    expect((await loop.cli(['state', 'append', 'schedule.id', '--json', '1'])).stderr).toBe(
      'state.json: schedule.id must be array, got string\n',
    )
  })

  it('removes a key and says whether it was there', async () => {
    const loop = await makeLoop()
    expect((await loop.cli(['state', 'remove', 'schedule.id'])).stdout).toBe(
      '{"schedule.id": "absent"}\n',
    )
    expect(await loop.state()).toEqual({})
    await loop.seed({ schedule: { id: 'job', empty: null }, lastSweepAt: 't' })
    expect((await loop.cli(['state', 'remove', 'schedule.id'])).stdout).toBe(
      '{"schedule.id": "removed"}\n',
    )
    expect((await loop.cli(['state', 'remove', 'schedule.empty'])).stdout).toBe(
      '{"schedule.empty": "absent"}\n',
    )
    expect((await loop.cli(['state', 'remove', 'schedule.missing'])).stdout).toContain('absent')
    expect((await loop.cli(['state', 'remove', 'lastSweepAt'])).stdout).toContain('removed')
    expect(await loop.state()).toEqual({ schedule: {} })
    expect((await loop.cli(['state', 'remove', 'schedule.a.b'])).stderr).toBe(
      'state.json: schedule.a must be object, got null\n',
    )
  })

  it('refuses a state file that is not a JSON object, or cannot be read', async () => {
    const loop = await makeLoop()
    await loop.seed([])
    expect((await loop.cli(['state', 'show'])).stderr).toBe(
      'state.json: state.json must be object, got array\n',
    )
    await writeFile(join(loop.stateDir, 'state.json'), '{broken')
    expect(await loop.cli(['state', 'show'])).toMatchObject({ code: 1, stdout: '' })
    const blocked = await makeLoop()
    await blocked.seed({})
    await rm(join(blocked.stateDir, 'state.json'))
    await mkdir(join(blocked.stateDir, 'state.json'))
    expect((await blocked.cli(['state', 'show'])).stderr).toContain('EISDIR')
  })
})
