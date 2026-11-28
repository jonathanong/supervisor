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

  it('lets explicit --dir and --repo-dir override config values', async () => {
    const notADir = join(temp, 'not-a-dir')
    await writeFile(notADir, 'file')
    const configWithHome = await writePolicyConfig(temp, 'override-home.json', {
      policy: PULL_DIR,
      scopes: [{ owner: 'example-org', kind: 'org', repos: '*', checkoutRoot: fakeHome }],
    })
    const configWithBadRoot = await writePolicyConfig(temp, 'bad-root.json', {
      policy: LAYERED_SUPERVISOR,
      scopes: [{ owner: 'example-org', kind: 'org', repos: '*', checkoutRoot: notADir }],
    })
    const gh = fixture({ files: [file('docs/guide.md')], reviews: [] })

    // Explicit --dir wins, while omitted --repo-dir still resolves from config.
    const explicitDir = await check(gh, ['--dir', LAYERED_SUPERVISOR, '--json'], {
      SUPERVISOR_CONFIG: configWithHome,
    })
    expect(explicitDir.stderr).toBe('')
    expect(explicitDir.shepherdCalls).toEqual([[`${REPO}#7`, join(fakeHome, 'example-repo')]])
    expect(JSON.parse(explicitDir.stdout)).toMatchObject({
      verdict: 'approves',
      nextStep: { action: 'request_review' },
    })

    // Explicit --repo-dir wins without reading checkoutRoot, while omitted --dir resolves from config.
    const explicitRepoDir = await check(gh, ['--repo-dir', PLAIN_REPO, '--json'], {
      SUPERVISOR_CONFIG: configWithBadRoot,
    })
    expect(explicitRepoDir.stderr).toBe('')
    expect(explicitRepoDir.shepherdCalls).toEqual([[`${REPO}#7`, PLAIN_REPO]])
    expect(JSON.parse(explicitRepoDir.stdout)).toMatchObject({
      verdict: 'comments',
      nextStep: { action: 'escalate' },
    })

    // Both explicit flags win and bypass both mergeAuthority.policy and checkoutRoot.
    const bothExplicit = await check(
      gh,
      ['--dir', LAYERED_SUPERVISOR, '--repo-dir', PLAIN_REPO, '--json'],
      { SUPERVISOR_CONFIG: configWithBadRoot },
    )
    expect(bothExplicit.stderr).toBe('')
    expect(bothExplicit.shepherdCalls).toEqual([[`${REPO}#7`, PLAIN_REPO]])
    expect(JSON.parse(bothExplicit.stdout)).toMatchObject({
      verdict: 'comments',
      nextStep: { action: 'escalate' },
    })
  })

  it('enforces requiredAlwaysHuman and fails closed when configured paths are broken', async () => {
    const strictConfig = await writePolicyConfig(temp, 'strict.json', {
      policy: LAYERED_SUPERVISOR,
      requiredAlwaysHuman: [{ name: 'payments paths', samples: ['payments/charge.ts'] }],
    })
    const refused = await check(fixture(), ['--json'], { SUPERVISOR_CONFIG: strictConfig })
    expect(refused.code).toBe(2)
    expect(refused.stderr).toContain('Supervisor policy must send payments paths')
    expect(refused.calls).toEqual([])
    expect(refused.shepherdCalls).toEqual([])

    const missing = await check(fixture(), ['--dir', PULL_DIR, '--json'], {
      SUPERVISOR_CONFIG: join(temp, 'does-not-exist.json'),
    })
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain('does-not-exist.json')
    expect(missing.calls).toEqual([])
  })

  it('resolves --dir and --repo-dir from config in --input mode', async () => {
    const configPath = await writePolicyConfig(temp, 'input-config.json', {
      policy: LAYERED_SUPERVISOR,
      scopes: [{ owner: 'example-org', kind: 'org', repos: '*', checkoutRoot: fakeHome }],
    })
    const env = { SUPERVISOR_CONFIG: configPath }

    // Resolves both --dir and --repo-dir (via facts.repository) so the repo carve-out merges.
    const layered = await runInputCli(['--input', policyDir('inputs/layered-docs.json')], env)
    expect(layered.stderr).toBe('')
    expect(layered.code).toBe(0)
    expect(layered.stdout).toContain('Next step: merge allowed')

    // Missing facts and non-repository facts.repository still resolve --dir without layering.
    const noFactsPath = join(temp, 'no-facts.json')
    const badRepoPath = join(temp, 'bad-repo.json')
    await writeFile(noFactsPath, JSON.stringify({ changedFiles: ['docs/guide.md'] }))
    await writeFile(
      badRepoPath,
      JSON.stringify({ changedFiles: ['docs/guide.md'], facts: { repository: 'not-a-repo' } }),
    )
    for (const path of [noFactsPath, badRepoPath]) {
      const res = await runInputCli(['--input', path, '--json'], env)
      expect(res.stderr).toBe('')
      expect(res.code).toBe(1)
      expect(JSON.parse(res.stdout)).toMatchObject({ nextStep: { action: 'escalate' } })
    }

    // Without --dir and without a config, --input exits 2 naming .supervisor.json.
    const noConfig = await runInputCli(['--input', policyDir('inputs/docs-pass.json')])
    expect(noConfig.code).toBe(2)
    expect(noConfig.stderr).toContain('.supervisor.json')
  })
})
