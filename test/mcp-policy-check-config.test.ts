import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { callPolicyCheck, textContent, writePolicyConfig } from './helpers/mcp.js'
import { check, file, fixture, policyDir, REPO } from './helpers/pull.js'
import { repoFixture } from './helpers/repo-fixture.js'

const LENIENT_DIR = policyDir('docs-light')
const PULL_DIR = policyDir('pull-facts')
const LAYERED_SUPERVISOR = policyDir('layered/supervisor')
const layeredRepo = await repoFixture('layered/repo-carve-out')

let temp: string

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'supervisor-mcp-config-'))
})

afterAll(async () => {
  await rm(temp, { recursive: true, force: true })
})

describe('MCP policy_check config enforcement and errors', () => {
  it('prevents a caller from overriding the configured policy, checkout, or classifiers', async () => {
    const strictConfig = await writePolicyConfig(temp, 'strict-base.json', {
      policy: LAYERED_SUPERVISOR,
      scopes: [{ owner: 'example-org', kind: 'org', repos: ['example-repo'] }],
    })
    const env = { SUPERVISOR_CONFIG: strictConfig }
    const gh = fixture({ files: [file('docs/guide.md')], reviews: [] })

    // Under the configured supervisor policy alone, docs/guide.md cannot merge.
    const normal = await callPolicyCheck(gh, { repository: REPO, pr: 7 }, { env })
    expect(normal.response.isError).toBeFalsy()
    expect((normal.response.structuredContent as Record<string, unknown>).nextStep).toMatchObject({
      action: 'escalate',
    })

    // Attempting to inject a looser policy dir, repoDir, supervisorPolicy, or classifier result fails.
    const overrides: Array<[Record<string, unknown>, string]> = [
      [{ repository: REPO, pr: 7, dir: LENIENT_DIR }, 'Unknown argument: dir.'],
      [{ repository: REPO, pr: 7, repoDir: layeredRepo }, 'Unknown argument: repoDir.'],
      [{ repository: REPO, pr: 7, supervisorPolicy: false }, 'Unknown argument: supervisorPolicy.'],
      [
        {
          repository: REPO,
          pr: 7,
          classifiers: { 'claude/code_review': { status: 'complete', value: 'pass' } },
        },
        'Unknown argument: classifiers.',
      ],
    ]
    for (const [args, message] of overrides) {
      const attempt = await callPolicyCheck(gh, args, { env })
      expect(attempt.response.isError).toBe(true)
      expect(textContent(attempt.response)).toBe(message)
      expect(attempt.calls).toEqual([])
      expect(attempt.shepherdCalls).toEqual([])
    }
  })

  it('resolves relative policy paths via config realpath and handles checkoutRoot edge cases', async () => {
    const gh = fixture({ files: [file('docs/guide.md')], reviews: [] })
    const expected = JSON.parse(
      (await check(gh, ['--dir', LAYERED_SUPERVISOR, '--supervisor-policy', '--json'])).stdout,
    )
    const run = (configPath: string, repository = REPO) =>
      callPolicyCheck(gh, { repository, pr: 7 }, { env: { SUPERVISOR_CONFIG: configPath } })
    const expectUnlayered = async (configPath: string) => {
      const res = await run(configPath)
      expect(res.response.isError).toBeFalsy()
      expect(res.response.structuredContent).toEqual(expected)
    }

    const realConfig = await writePolicyConfig(temp, 'real-config.json', {
      policy: relative(temp, LAYERED_SUPERVISOR),
      scopes: [
        { owner: 'other-org', kind: 'org', repos: '*' },
        { owner: 'example-org', kind: 'org', repos: ['other-repo'], checkoutRoot: temp },
        {
          owner: 'example-org',
          kind: 'org',
          repos: '*',
          excludedRepos: ['example-repo'],
          checkoutRoot: temp,
        },
      ],
    })
    const linkDir = await mkdtemp(join(tmpdir(), 'supervisor-mcp-link-'))
    const linkPath = join(linkDir, 'config-link.json')
    try {
      await symlink(realConfig, linkPath)
      await expectUnlayered(linkPath)

      // A regular file at <checkoutRoot>/<repo> is ignored, not treated as a checkout directory.
      const fileRoot = join(temp, 'file-root')
      await mkdir(fileRoot, { recursive: true })
      await writeFile(join(fileRoot, 'example-repo'), 'not a directory')
      const fileRootConfig = await writePolicyConfig(temp, 'file-root-config.json', {
        policy: LAYERED_SUPERVISOR,
        requiredAlwaysHuman: [],
        scopes: [
          { owner: 'example-org', kind: 'org', repos: ['example-repo'], checkoutRoot: fileRoot },
        ],
      })
      await expectUnlayered(fileRootConfig)

      // Different owner/repo casing still matches the scope and resolves the canonical checkout dir.
      const casedRoot = join(temp, 'cased-root')
      await mkdir(casedRoot, { recursive: true })
      await symlink(layeredRepo, join(casedRoot, 'example-repo'))
      const casedConfig = await writePolicyConfig(temp, 'cased-config.json', {
        policy: LAYERED_SUPERVISOR,
        scopes: [
          { owner: 'example-org', kind: 'org', repos: ['example-repo'], checkoutRoot: casedRoot },
        ],
      })
      const cased = await run(casedConfig, 'Example-Org/Example-Repo')
      expect(cased.response.isError).toBeFalsy()
      expect(cased.shepherdCalls).toEqual([
        ['Example-Org/Example-Repo#7', join(casedRoot, 'example-repo')],
      ])
      expect(cased.response.structuredContent).toMatchObject({
        verdict: 'approves',
        nextStep: { action: 'request_review' },
      })

      // An existing checkoutRoot that lacks the repository, or has a dangling symlink, falls back.
      const emptyRoot = join(temp, 'empty-root')
      await mkdir(emptyRoot, { recursive: true })
      const emptyRootConfig = await writePolicyConfig(temp, 'empty-root-config.json', {
        policy: LAYERED_SUPERVISOR,
        scopes: [{ owner: 'example-org', kind: 'org', repos: '*', checkoutRoot: emptyRoot }],
      })
      await expectUnlayered(emptyRootConfig)
      await symlink(join(temp, 'does-not-exist'), join(emptyRoot, 'example-repo'))
      await expectUnlayered(emptyRootConfig)

      // A non-ENOENT readdir failure (ENOTDIR because checkoutRoot is a file) fails closed.
      const notADir = join(temp, 'not-a-dir')
      await writeFile(notADir, 'file')
      const badRootConfig = await writePolicyConfig(temp, 'bad-root-config.json', {
        policy: LAYERED_SUPERVISOR,
        scopes: [{ owner: 'example-org', kind: 'org', repos: '*', checkoutRoot: notADir }],
      })
      const statErr = await run(badRootConfig)
      expect(statErr.response.isError).toBe(true)
      expect(textContent(statErr.response)).toContain('ENOTDIR')
    } finally {
      await rm(linkDir, { recursive: true, force: true })
    }
  })

  it('enforces requiredAlwaysHuman and reports invalid targets, missing config, and read errors', async () => {
    const strictConfig = await writePolicyConfig(temp, 'required-config.json', {
      policy: LAYERED_SUPERVISOR,
      requiredAlwaysHuman: [{ name: 'payments paths', samples: ['payments/charge.ts'] }],
    })
    const refused = await callPolicyCheck(
      fixture(),
      { repository: REPO, pr: 7 },
      { env: { SUPERVISOR_CONFIG: strictConfig } },
    )
    expect(refused.response.isError).toBe(true)
    expect(textContent(refused.response)).toContain('Supervisor policy must send payments paths')
    expect(refused.calls).toEqual([])

    const invalidCases: Array<[Record<string, unknown>, string]> = [
      [{ repository: 123, pr: 7 }, 'repository must be a string.'],
      [{ repository: 'not-a-repo', pr: 7 }, 'must look like <owner>/<repo>.'],
      [{ repository: REPO, pr: '7' }, 'pr must be an integer.'],
      [{ repository: REPO, pr: 0 }, 'must be a pull request number.'],
      [{ repository: REPO, pr: 1.5 }, 'must be a pull request number.'],
    ]
    for (const [args, message] of invalidCases) {
      const { response, calls, shepherdCalls } = await callPolicyCheck(fixture(), args)
      expect(response.isError).toBe(true)
      expect(textContent(response)).toContain(message)
      expect(calls).toEqual([])
      expect(shepherdCalls).toEqual([])
    }

    const noConfig = await callPolicyCheck(fixture(), { repository: REPO, pr: 7 }, { cwd: temp })
    expect(noConfig.response.isError).toBe(true)
    expect(textContent(noConfig.response)).toContain('.supervisor.json')

    const validConfig = await writePolicyConfig(temp, 'valid-config.json', { policy: PULL_DIR })
    const failed = await callPolicyCheck(
      fixture({ shepherd: new Error('shepherd failed') }),
      { repository: REPO, pr: 7 },
      { env: { SUPERVISOR_CONFIG: validConfig } },
    )
    expect(failed.response.isError).toBe(true)
    expect(textContent(failed.response)).toContain('shepherd failed')
  })
})
