import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runCli } from '../src/cli/run.js'
import { writePolicyConfig } from './helpers/mcp.js'
import { check, file, fixture, policyDir, REPO } from './helpers/pull.js'
import { repoFixture } from './helpers/repo-fixture.js'

const LAYERED_SUPERVISOR = policyDir('layered/supervisor')
const PLAIN_REPO = policyDir('layered/repo-plain')
const PULL_DIR = policyDir('pull-facts')
const layeredRepo = await repoFixture('layered/repo-carve-out')
const ESCALATE = { verdict: 'comments', nextStep: { action: 'escalate' } }

let temp: string
let linkDir: string
let fakeHome: string

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'supervisor-cli-config-'))
  linkDir = await mkdtemp(join(tmpdir(), 'supervisor-cli-link-'))
  fakeHome = await mkdtemp(join(tmpdir(), 'supervisor-cli-home-'))
  await symlink(layeredRepo, join(fakeHome, 'example-repo'))
})

afterAll(async () => {
  await Promise.all([
    rm(temp, { recursive: true, force: true }),
    rm(linkDir, { recursive: true, force: true }),
    rm(fakeHome, { recursive: true, force: true }),
  ])
})

async function runInputCli(argv: string[], env: Record<string, string | undefined> = {}) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(['policy', 'check', ...argv], {
    env,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    startMcp: async () => undefined,
    runProcess: vi.fn(),
    shepherdStatus: vi.fn(),
    now: () => new Date(0),
  })
  return { code, stdout: out.join(''), stderr: err.join('') }
}

describe('supervisor policy check config defaults', () => {
  it('resolves --dir via symlinked config realpath and --repo-dir via checkoutRoot "~"', async () => {
    const realConfig = await writePolicyConfig(temp, 'symlink-home.json', {
      policy: relative(temp, LAYERED_SUPERVISOR),
      scopes: [{ owner: 'example-org', kind: 'org', repos: '*', checkoutRoot: '~' }],
    })
    const linkPath = join(linkDir, 'supervisor-config.json')
    await symlink(realConfig, linkPath)

    vi.stubEnv('HOME', fakeHome)
    vi.stubEnv('USERPROFILE', fakeHome)
    try {
      const gh = fixture({ files: [file('docs/guide.md')], reviews: [] })
      const res = await check(gh, ['--json'], { SUPERVISOR_CONFIG: linkPath })
      expect(res.stderr).toBe('')
      expect(res.code).toBe(1)
      expect(res.shepherdCalls).toEqual([[`${REPO}#7`, join(fakeHome, 'example-repo')]])
      expect(JSON.parse(res.stdout)).toMatchObject({
        verdict: 'approves',
        nextStep: { action: 'request_review' },
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('evaluates only --dir when passed alone with a config present, and lets explicit flags win', async () => {
    const notADir = join(temp, 'not-a-dir')
    await writeFile(notADir, 'file')
    const configWithHome = await writePolicyConfig(temp, 'override-home.json', {
      policy: PULL_DIR,
      requiredAlwaysHuman: [{ name: 'payments paths', samples: ['payments/charge.ts'] }],
      scopes: [{ owner: 'example-org', kind: 'org', repos: '*', checkoutRoot: fakeHome }],
    })
    const configWithBadRoot = await writePolicyConfig(temp, 'bad-root.json', {
      policy: LAYERED_SUPERVISOR,
      scopes: [{ owner: 'example-org', kind: 'org', repos: '*', checkoutRoot: notADir }],
    })
    const gh = fixture({ files: [file('docs/guide.md')], reviews: [] })

    const plainDir = await check(fixture(), ['--dir', PULL_DIR, '--json'], {
      SUPERVISOR_CONFIG: configWithHome,
    })
    expect(plainDir.stderr).toBe('')
    expect(plainDir.code).toBe(0)
    expect(plainDir.shepherdCalls).toEqual([[`${REPO}#7`, process.cwd()]])

    // Explicit --dir with --supervisor-policy still skips implicit checkout layering in PR and --input modes.
    const noReq = {
      SUPERVISOR_CONFIG: await writePolicyConfig(temp, 'no-required.json', {
        policy: PULL_DIR,
        scopes: [{ owner: 'example-org', kind: 'org', repos: '*', checkoutRoot: fakeHome }],
      }),
    }
    const supFlags = ['--dir', LAYERED_SUPERVISOR, '--supervisor-policy', '--json']
    const supDirOnly = await check(gh, supFlags, noReq)
    expect(supDirOnly.stderr).toBe('')
    expect(supDirOnly.code).toBe(1)
    expect(supDirOnly.shepherdCalls).toEqual([[`${REPO}#7`, process.cwd()]])
    expect(JSON.parse(supDirOnly.stdout)).toMatchObject(ESCALATE)

    const dirInput = await runInputCli(
      [...supFlags, '--input', policyDir('inputs/layered-docs.json')],
      noReq,
    )
    expect(dirInput.stderr).toBe('')
    expect(dirInput.code).toBe(1)
    expect(JSON.parse(dirInput.stdout)).toMatchObject(ESCALATE)

    // Explicit --repo-dir wins without reading checkoutRoot, alone or alongside explicit --dir.
    for (const flags of [
      ['--repo-dir', PLAIN_REPO, '--json'],
      ['--dir', LAYERED_SUPERVISOR, '--repo-dir', PLAIN_REPO, '--json'],
    ]) {
      const res = await check(gh, flags, { SUPERVISOR_CONFIG: configWithBadRoot })
      expect(res.stderr).toBe('')
      expect(res.shepherdCalls).toEqual([[`${REPO}#7`, PLAIN_REPO]])
      expect(JSON.parse(res.stdout)).toMatchObject(ESCALATE)
    }
  })

  it('enforces requiredAlwaysHuman and suggests --dir on missing config only', async () => {
    const strictConfig = await writePolicyConfig(temp, 'strict.json', {
      policy: LAYERED_SUPERVISOR,
      requiredAlwaysHuman: [{ name: 'payments paths', samples: ['payments/charge.ts'] }],
    })
    const refused = await check(fixture(), ['--json'], { SUPERVISOR_CONFIG: strictConfig })
    expect(refused.code).toBe(2)
    expect(refused.stderr).toContain('Supervisor policy must send payments paths')
    expect(refused.calls).toEqual([])
    expect(refused.shepherdCalls).toEqual([])

    const missing = await check(fixture(), ['--json'], {
      SUPERVISOR_CONFIG: join(temp, 'does-not-exist.json'),
    })
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain('does-not-exist.json')
    expect(missing.stderr).toContain('or pass --dir')
    expect(missing.calls).toEqual([])

    const invalidPath = join(temp, 'invalid.json')
    await writeFile(invalidPath, '{"scopes": 1}')
    const invalid = await check(fixture(), ['--json'], { SUPERVISOR_CONFIG: invalidPath })
    expect(invalid.code).toBe(2)
    expect(invalid.stderr).toContain('invalid.json')
    expect(invalid.stderr).not.toContain('or pass --dir')

    const notADir = join(temp, 'bad-root-file')
    await writeFile(notADir, 'file')
    const badRoot = await writePolicyConfig(temp, 'bad-root-err.json', {
      policy: LAYERED_SUPERVISOR,
      scopes: [{ owner: 'example-org', kind: 'org', repos: '*', checkoutRoot: notADir }],
    })
    const enotdir = await check(fixture(), ['--json'], { SUPERVISOR_CONFIG: badRoot })
    expect(enotdir.code).toBe(2)
    expect(enotdir.stderr).toContain('ENOTDIR')
    expect(enotdir.stderr).not.toContain('or pass --dir')
  })

  it('resolves --dir and --repo-dir from config in --input mode when --dir is omitted', async () => {
    const configPath = await writePolicyConfig(temp, 'input-config.json', {
      policy: LAYERED_SUPERVISOR,
      scopes: [{ owner: 'example-org', kind: 'org', repos: '*', checkoutRoot: fakeHome }],
    })
    const env = { SUPERVISOR_CONFIG: configPath }

    const layered = await runInputCli(['--input', policyDir('inputs/layered-docs.json')], env)
    expect(layered.stderr).toBe('')
    expect(layered.code).toBe(0)
    expect(layered.stdout).toContain('Next step: merge allowed')

    const noFacts = join(temp, 'no-facts.json')
    const badRepo = join(temp, 'bad-repo.json')
    await writeFile(noFacts, JSON.stringify({ changedFiles: ['docs/guide.md'] }))
    await writeFile(
      badRepo,
      JSON.stringify({ changedFiles: ['docs/guide.md'], facts: { repository: 'not-a-repo' } }),
    )
    for (const path of [noFacts, badRepo]) {
      const res = await runInputCli(['--input', path, '--json'], env)
      expect(res.stderr).toBe('')
      expect(res.code).toBe(1)
      expect(JSON.parse(res.stdout)).toMatchObject(ESCALATE)
    }

    const noConfig = await runInputCli(['--input', policyDir('inputs/docs-pass.json')])
    expect(noConfig.code).toBe(2)
    expect(noConfig.stderr).toContain('.supervisor.json')
    expect(noConfig.stderr).toContain('or pass --dir')
  })
})
