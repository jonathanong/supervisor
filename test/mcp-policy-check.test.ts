import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { callPolicyCheck, textContent, writePolicyConfig } from './helpers/mcp.js'
import { check, file, fixture, HEAD, policyDir, REPO, type GhFixture } from './helpers/pull.js'
import { repoFixture } from './helpers/repo-fixture.js'

const PULL_DIR = policyDir('pull-facts')
const LAYERED_SUPERVISOR = policyDir('layered/supervisor')
const layeredRepo = await repoFixture('layered/repo-carve-out')

let temp: string
let pullConfig: string
let layeredConfig: string
let checkoutRoot: string

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'supervisor-mcp-policy-'))
  pullConfig = await writePolicyConfig(temp, 'pull-config.json', { policy: PULL_DIR })
  checkoutRoot = await mkdtemp(join(tmpdir(), 'supervisor-mcp-root-'))
  await symlink(layeredRepo, join(checkoutRoot, 'example-repo'))
  layeredConfig = await writePolicyConfig(temp, 'layered-config.json', {
    policy: LAYERED_SUPERVISOR,
    scopes: [{ owner: 'example-org', kind: 'org', repos: '*', checkoutRoot }],
  })
})

afterAll(async () => {
  await rm(temp, { recursive: true, force: true })
  await rm(checkoutRoot, { recursive: true, force: true })
})

describe('MCP policy_check and CLI agreement', () => {
  it('agrees with `supervisor policy check <owner>/<repo> <pr> --dir ... --supervisor-policy --json`', async () => {
    const cases: Array<{
      name: string
      gh: GhFixture
      configPath: string
      cliOptions: string[]
      expectedShepherdCwd?: string
    }> = [
      {
        name: 'merge allowed',
        gh: fixture({ shepherd: { action: 'merge', headSha: HEAD, log: 'all checks passed' } }),
        configPath: pullConfig,
        cliOptions: ['--dir', PULL_DIR, '--supervisor-policy', '--json'],
      },
      {
        name: 'pr-shepherd not ready',
        gh: fixture({ shepherd: { action: 'wait', headSha: HEAD, log: 'checks pending' } }),
        configPath: pullConfig,
        cliOptions: ['--dir', PULL_DIR, '--supervisor-policy', '--json'],
      },
      {
        name: 'request review with reviewDepth',
        gh: fixture({ files: [file('docs/guide.md')], reviews: [] }),
        configPath: pullConfig,
        cliOptions: ['--dir', PULL_DIR, '--supervisor-policy', '--json'],
      },
      {
        name: 'escalate on draft blocker and uncovered file',
        gh: fixture({
          files: [file('src/index.ts'), file('scripts/run.ts')],
          reviews: [],
          shepherd: { action: 'wait', headSha: HEAD },
          pull: { draft: true },
        }),
        configPath: pullConfig,
        cliOptions: ['--dir', PULL_DIR, '--supervisor-policy', '--json'],
      },
      {
        name: 'layered supervisor and repository policies from scope checkoutRoot',
        gh: fixture({ files: [file('docs/guide.md')], reviews: [] }),
        configPath: layeredConfig,
        cliOptions: [
          '--dir',
          LAYERED_SUPERVISOR,
          '--repo-dir',
          join(checkoutRoot, 'example-repo'),
          '--supervisor-policy',
          '--json',
        ],
        expectedShepherdCwd: join(checkoutRoot, 'example-repo'),
      },
    ]

    for (const testCase of cases) {
      const cli = await check(testCase.gh, testCase.cliOptions)
      expect(cli.stderr, testCase.name).toBe('')
      const expected = JSON.parse(cli.stdout) as Record<string, unknown>

      const { response, shepherdCalls } = await callPolicyCheck(
        testCase.gh,
        { repository: REPO, pr: 7 },
        { env: { SUPERVISOR_CONFIG: testCase.configPath } },
      )
      expect(response.isError, testCase.name).toBeFalsy()
      expect(JSON.parse(textContent(response)), testCase.name).toEqual(expected)
      expect(response.structuredContent, testCase.name).toEqual(expected)
      if (testCase.expectedShepherdCwd) {
        expect(shepherdCalls, testCase.name).toEqual([[`${REPO}#7`, testCase.expectedShepherdCwd]])
      }
    }
  })
})
