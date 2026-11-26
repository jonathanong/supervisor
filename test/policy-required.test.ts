import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateConfigData } from '../src/cli/config-validate.js'
import { requiredAlwaysHumanFromConfig } from '../src/cli/policy-required.js'
import { runCli, type CliIo } from '../src/cli/run.js'

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/policies/${name}`, import.meta.url))
const exampleConfigPath = fileURLToPath(new URL('../examples/config.example.json', import.meta.url))
const supervisorDir = fixture('layered/supervisor')
const repoDir = fixture('layered/repo-carve-out')
const input = fixture('inputs/layered-docs.json')
const required = [{ name: 'payments paths', samples: ['payments/charge.ts'] }]
const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'supervisor-required-'))
  tempDirs.push(dir)
  return dir
}

/** The example config with `mergeAuthority` keys replaced; an undefined value drops the key. */
async function configData(mergeAuthority: Record<string, unknown>): Promise<unknown> {
  const raw = JSON.parse(await readFile(exampleConfigPath, 'utf8')) as {
    mergeAuthority: Record<string, unknown>
  }
  return { ...raw, mergeAuthority: { ...raw.mergeAuthority, ...mergeAuthority } }
}

async function configFile(mergeAuthority: Record<string, unknown>): Promise<string> {
  const path = join(await tempDir(), 'config.json')
  await writeFile(path, JSON.stringify(await configData(mergeAuthority)))
  return path
}

async function cli(argv: string[], env: Record<string, string>) {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = {
    env,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    startMcp: vi.fn(async () => undefined),
    runProcess: vi.fn(),
    now: () => new Date(0),
  }
  const code = await runCli(argv, io)
  return { code, stdout: out.join(''), stderr: err.join('') }
}

const check = ['policy', 'check', '--dir', supervisorDir, '--input', input]
const explain = ['policy', 'explain', supervisorDir, '--repo-dir', repoDir]

afterEach(async () => {
  while (tempDirs.length > 0) await rm(tempDirs.pop()!, { recursive: true, force: true })
})

describe('mergeAuthority.requiredAlwaysHuman in the config schema', () => {
  const validate = async (requiredAlwaysHuman: unknown) =>
    validateConfigData(await configData({ requiredAlwaysHuman }))

  it('accepts a list, an empty list, and no key', async () => {
    expect(await validate(required)).toEqual({ valid: true })
    expect(await validate([])).toEqual({ valid: true })
    expect(await validate(undefined)).toEqual({ valid: true })
  })

  it('rejects a requirement with no samples or an empty name', async () => {
    expect((await validate([{ name: 'payments paths', samples: [] }])).valid).toBe(false)
    expect((await validate([{ name: '', samples: ['a'] }])).valid).toBe(false)
  })
})

describe('requiredAlwaysHumanFromConfig', () => {
  it('is empty when there is no config in the directory and none is named', async () => {
    expect(await requiredAlwaysHumanFromConfig({}, await tempDir())).toEqual([])
  })

  it('reads .supervisor.json in the directory, and an absent key means none', async () => {
    const dir = await tempDir()
    await copyFile(
      await configFile({ requiredAlwaysHuman: required }),
      join(dir, '.supervisor.json'),
    )
    expect(await requiredAlwaysHumanFromConfig({}, dir)).toEqual(required)
    const named = { SUPERVISOR_CONFIG: await configFile({}) }
    expect(await requiredAlwaysHumanFromConfig(named, dir)).toEqual([])
  })

  it('throws for a named config that is missing', async () => {
    const missing = join(await tempDir(), 'missing.json')
    const load = requiredAlwaysHumanFromConfig({ SUPERVISOR_CONFIG: missing }, await tempDir())
    await expect(load).rejects.toThrow(missing)
  })
})

describe('policy commands take the required list from the config', () => {
  it('loads the policy when the config requires nothing', async () => {
    const empty = { SUPERVISOR_CONFIG: await configFile({ requiredAlwaysHuman: [] }) }
    expect((await cli([...check, '--supervisor-policy'], empty)).code).toBe(1)
    const absent = { SUPERVISOR_CONFIG: await configFile({}) }
    expect((await cli([...check, '--supervisor-policy'], absent)).code).toBe(1)
  })

  it('exits 2 and names the class when the policy lacks a required path', async () => {
    const env = { SUPERVISOR_CONFIG: await configFile({ requiredAlwaysHuman: required }) }
    const checked = await cli([...check, '--supervisor-policy'], env)
    expect(checked.code).toBe(2)
    expect(checked.stderr).toContain('Supervisor policy must send payments paths')
    const layeredCheck = await cli([...check, '--repo-dir', repoDir], env)
    expect(layeredCheck.code).toBe(2)
    expect(layeredCheck.stderr).toContain('payments paths')
    const explained = await cli(explain, env)
    expect(explained.code).toBe(2)
    expect(explained.stderr).toContain('payments paths')
  })

  it('exits 2 when the named config is missing or invalid', async () => {
    const missing = { SUPERVISOR_CONFIG: join(await tempDir(), 'missing.json') }
    const gone = await cli([...check, '--supervisor-policy'], missing)
    expect(gone.code).toBe(2)
    expect(gone.stderr).toContain('missing.json')
    const invalidPath = join(await tempDir(), 'invalid.json')
    await writeFile(invalidPath, '{"scopes": 1}')
    const invalid = { SUPERVISOR_CONFIG: invalidPath }
    const bad = await cli([...check, '--supervisor-policy'], invalid)
    expect(bad.code).toBe(2)
    expect(bad.stderr).toContain('invalid.json')
    expect((await cli(explain, invalid)).code).toBe(2)
  })

  it('does not read the config for a command that loads no supervisor policy', async () => {
    const env = { SUPERVISOR_CONFIG: join(await tempDir(), 'missing.json') }
    expect((await cli(['policy', 'explain', fixture('docs-light')], env)).code).toBe(0)
    const plain = await cli(
      ['policy', 'check', '--dir', fixture('docs-light'), '--input', input],
      env,
    )
    expect(plain.stderr).not.toContain('missing.json')
  })
})
