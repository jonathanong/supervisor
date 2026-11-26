import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultCliIo } from '../src/cli/run.js'
import { dumps } from '../src/state/json.js'
import { runProcess } from '../src/state/process.js'
import { FIELDS } from '../src/state/store.js'
import { cleanupLoops, makeLoop } from './helpers/loop.js'

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  body: string,
) => unknown

describe('supervisor state advance-hh', () => {
  afterEach(cleanupLoops)

  it('stores the cursor and seen ids of one owner from that owner’s wait result', async () => {
    const loop = await makeLoop()
    await loop.seed({ hookHarness: { 'example-user': { cursor: 'u1', seen: ['x'] } } })
    const last = { cursor: 'c2', events: [{ id: 'a' }, { id: 'b' }, { id: 'a' }, { no: 'id' }, 7] }
    await writeFile(join(loop.stateDir, 'hh-last.example-org.json'), JSON.stringify(last))
    const advanced = await loop.cli(['state', 'advance-hh', '--owner', 'example-org'])
    expect(advanced.stdout).toBe('{"events": 3, "cursorAdvanced": true}\n')
    expect((await loop.state()).hookHarness).toEqual({
      'example-user': { cursor: 'u1', seen: ['x'] },
      'example-org': { seen: ['a', 'b'], cursor: 'c2' },
    })
  })

  it('keeps the newest 200 seen ids and the old cursor when the result has none', async () => {
    const loop = await makeLoop()
    const seen = Array.from({ length: 199 }, (_, i) => `old-${i}`)
    await loop.seed({ hookHarness: { 'example-org': { cursor: 'c1', seen } } })
    const events = [{ id: 'new-1' }, { id: 'new-2' }]
    await writeFile(join(loop.stateDir, 'hh-last.example-org.json'), JSON.stringify({ events }))
    const advanced = await loop.cli(['state', 'advance-hh', '--owner', 'example-org'])
    expect(advanced.stdout).toBe('{"events": 2, "cursorAdvanced": false}\n')
    const harness = (await loop.state()).hookHarness['example-org']
    expect(harness.cursor).toBe('c1')
    expect(harness.seen).toHaveLength(200)
    expect(harness.seen.slice(0, 1).concat(harness.seen.slice(-2))).toEqual([
      'old-1',
      'new-1',
      'new-2',
    ])
  })

  it('needs a valid owner whose wait result exists and is an object', async () => {
    const loop = await makeLoop()
    expect((await loop.cli(['state', 'advance-hh'])).code).toBe(2)
    expect((await loop.cli(['state', 'advance-hh', '--owner', '../x'])).code).toBe(2)
    const missing = await loop.cli(['state', 'advance-hh', '--owner', 'example-org'])
    expect(missing).toMatchObject({ code: 1, stderr: expect.stringContaining('ENOENT') })
    await writeFile(join(loop.stateDir, 'hh-last.example-org.json'), '{}')
    const empty = await loop.cli(['state', 'advance-hh', '--owner', 'example-org'])
    expect(empty.stdout).toBe('{"events": 0, "cursorAdvanced": false}\n')
    await writeFile(join(loop.stateDir, 'hh-last.example-org.json'), '[1]')
    expect((await loop.cli(['state', 'advance-hh', '--owner', 'example-org'])).code).toBe(1)
  })
})

describe('supervisor state update-check-script', () => {
  afterEach(cleanupLoops)

  it('prints a script for the given owner with merged, restricted and dry targets', async () => {
    const loop = await makeLoop()
    const repos = [
      '--repo',
      'one:npm',
      '--repo',
      'two',
      '--repo',
      'one:pip,npm',
      '--repo',
      'three:',
    ]
    const args = ['state', 'update-check-script', '--owner', 'example-org', ...repos, '--dry']
    const { code, stdout } = await loop.cli(args)
    expect(code).toBe(0)
    expect(stdout.split('\n').slice(0, 4)).toEqual([
      "const ORG = 'example-org'",
      "const TARGETS = { 'one': ['npm', 'pip'], 'two': null, 'three': null }",
      'const DRY = true',
      '',
    ])
    expect(stdout.endsWith("out.join('\\n')\n")).toBe(true)
    expect(() => new AsyncFunction(stdout)).not.toThrow()
  })

  it('lets an unrestricted target win over a restricted one, in either order', async () => {
    const loop = await makeLoop()
    const repos = ['--repo', 'one', '--repo', 'one:npm', '--repo', 'two:npm', '--repo', 'two']
    const args = ['state', 'update-check-script', '--owner', 'example-org', ...repos]
    const { stdout } = await loop.cli(args)
    expect(stdout).toContain("const TARGETS = { 'one': null, 'two': null }\nconst DRY = false\n")
  })

  it('defaults the owner only when the config has one, and rejects unsafe names', async () => {
    const loop = await makeLoop()
    const several = await loop.cli(['state', 'update-check-script', '--repo', 'one'])
    expect(several).toMatchObject({ code: 2, stdout: '' })
    expect(several.stderr).toContain('--owner is required when the config has more than one owner')
    const single = await makeLoop({ scopes: [{ owner: 'example-user', kind: 'user', repos: '*' }] })
    expect((await single.cli(['state', 'update-check-script', '--repo', 'one'])).stdout).toContain(
      "const ORG = 'example-user'\n",
    )
    expect((await loop.cli(['state', 'update-check-script', '--owner', 'o'])).code).toBe(2)
    for (const repo of ["x'];alert(1)//", 'one:npm,', 'one:n pm']) {
      const bad = await loop.cli(['state', 'update-check-script', '--owner', 'o', '--repo', repo])
      expect(bad).toMatchObject({ code: 1, stdout: '' })
      expect(bad.stderr).toContain('must be name or name:ecosystem[,ecosystem]')
    }
    const owner = await loop.cli(['state', 'update-check-script', '--owner', "o'", '--repo', 'one'])
    expect(owner.stderr).toBe("update-check-script: owner 'o'' is not a valid owner name\n")
  })
})

describe('supervisor state command line', () => {
  afterEach(cleanupLoops)

  it('prints help that names every subcommand and field, without needing a config', async () => {
    const loop = await makeLoop()
    loop.env.SUPERVISOR_CONFIG = '/nonexistent/config.json'
    for (const args of [['--help'], ['-h'], ['set', '--help'], ['watch', '-h']]) {
      const help = await loop.cli(['state', ...args])
      expect(help).toMatchObject({ code: 0, stderr: '' })
      for (const field of Object.keys(FIELDS)) {
        expect(help.stdout).toContain(field)
      }
    }
    expect((await loop.cli(['--help'])).stdout).toContain('state <subcommand>')
    const bare = await loop.cli(['state'])
    expect(bare).toMatchObject({ code: 2, stdout: '' })
    expect(bare.stderr).toContain('Usage: supervisor state')
  })

  it('exits 2 on an unknown subcommand and 1 on a config it cannot use', async () => {
    const loop = await makeLoop()
    const unknown = await loop.cli(['state', 'explode'])
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('supervisor state: unknown subcommand: explode\nUsage:')
    const noDir = await makeLoop({ stateDir: undefined })
    expect(await noDir.cli(['state', 'show'])).toMatchObject({
      code: 1,
      stderr: expect.stringContaining('stateDir is required by this command'),
    })
    loop.env.SUPERVISOR_CONFIG = '/nonexistent/config.json'
    const missing = await loop.cli(['state', 'show'])
    expect(missing.code).toBe(1)
    expect(missing.stderr).toMatch(/^supervisor config \/nonexistent\/config\.json: /)
  })

  it('creates the state directory on first use', async () => {
    const loop = await makeLoop()
    expect((await loop.cli(['state', 'show'])).stdout).toBe('[]\n')
    await mkdir(loop.stateDir, { recursive: true })
    expect((await loop.cli(['state', 'sweep-done'])).code).toBe(0)
  })
})

describe('process runner and JSON output', () => {
  it('runs a command from an argument array and returns its code and output', async () => {
    const script =
      'process.stdout.write(process.argv[1]); process.stderr.write("e"); process.exitCode = 3'
    expect(await runProcess(process.execPath, ['-e', script, '$HOME; "quoted"'])).toEqual({
      code: 3,
      stdout: '$HOME; "quoted"',
      stderr: 'e',
    })
    const killed = await runProcess(process.execPath, [
      '-e',
      'process.kill(process.pid, "SIGKILL")',
    ])
    expect(killed.code).toBe(1)
    await expect(runProcess('/nonexistent/supervisor-test-binary', [])).rejects.toThrow(/ENOENT/)
    expect(defaultCliIo.now().getTime()).toBeGreaterThan(Date.parse('2026-01-01T00:00:00Z'))
  })

  it('prints spaced separators by default and none when compact', () => {
    const value = { a: [1, 'é', null, true], b: {}, c: [] }
    expect(dumps(value)).toBe('{"a": [1, "\\u00e9", null, true], "b": {}, "c": []}')
    expect(dumps(value, true)).toBe('{"a":[1,"\\u00e9",null,true],"b":{},"c":[]}')
  })
})
