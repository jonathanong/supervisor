import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverPolicies, selectRulesForFile } from '../src/policy/discover.js'
import { PolicyLoadError } from '../src/policy/types.js'

const nestedFixtureDir = fileURLToPath(
  new URL('./fixtures/policies/nested-inherit', import.meta.url),
)
const tempDirs: string[] = []

async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'supervisor-policy-test-'))
  tempDirs.push(dir)
  return dir
}

describe('policy discovery and inheritance', () => {
  afterEach(async () => {
    while (tempDirs.length > 0) {
      await rm(tempDirs.pop()!, { recursive: true, force: true })
    }
  })

  it('discovers root and nested policies and applies nearest-enforcing + nested: inherit', async () => {
    const policies = await discoverPolicies(nestedFixtureDir)
    expect(policies.map((p) => p.path)).toEqual([
      '.claude/approvals.yml',
      'services/payments/.claude/approvals.yml',
    ])

    const paySelection = selectRulesForFile(policies, 'services/payments/src/charge.ts')
    expect(paySelection.decidingPolicy?.path).toBe('services/payments/.claude/approvals.yml')
    expect(paySelection.rules.map((r) => r.purpose)).toEqual([
      'Payments service requires deep review',
      'Always require one non-author human across the repository',
    ])

    const rootSelection = selectRulesForFile(policies, 'src/index.ts')
    expect(rootSelection.decidingPolicy?.path).toBe('.claude/approvals.yml')
    expect(rootSelection.rules).toHaveLength(2)
  })

  it('passes over observing child policy and inherits ancestor locals', async () => {
    const dir = await makeTempRepo()
    await mkdir(join(dir, '.claude'), { recursive: true })
    await mkdir(join(dir, 'packages/app/.claude'), { recursive: true })
    await writeFile(
      join(dir, '.claude/approvals.yaml'),
      `version: 1
locals:
  org_team:
    - example-org/core
rules:
  - purpose: Root fallback
    paths: ['**']
    verdict: { claude: comments, seats: [{ count: 1, from: '@org_team' }] }
`,
    )
    await writeFile(
      join(dir, 'packages/app/.claude/approvals.yml'),
      `version: 1
mode: observe
rules:
  - purpose: Observing rule using inherited local
    paths: ['**']
    verdict: { claude: comments, seats: [{ count: 1, from: '@org_team' }] }
`,
    )
    const policies = await discoverPolicies(dir)
    expect(policies).toHaveLength(2)
    expect(policies[1]!.effectiveObserve).toBe(true)

    const selected = selectRulesForFile(policies, 'packages/app/index.ts')
    expect(selected.decidingPolicy?.path).toBe('.claude/approvals.yaml')
    expect(selected.rules.map((r) => r.purpose)).toEqual(['Root fallback'])
  })

  it('refuses both approvals.yml and approvals.yaml or nested .claude inside .claude', async () => {
    const bothDir = await makeTempRepo()
    await mkdir(join(bothDir, '.claude'), { recursive: true })
    const validYaml =
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n'
    await writeFile(join(bothDir, '.claude/approvals.yml'), validYaml)
    await writeFile(join(bothDir, '.claude/approvals.yaml'), validYaml)
    await expect(discoverPolicies(bothDir)).rejects.toThrow(PolicyLoadError)

    const nestedClaudeDir = await makeTempRepo()
    await mkdir(join(nestedClaudeDir, '.claude/sub/.claude'), { recursive: true })
    await writeFile(join(nestedClaudeDir, '.claude/sub/.claude/approvals.yml'), validYaml)
    await expect(discoverPolicies(nestedClaudeDir)).rejects.toThrow('inside another .claude')
  })

  it('returns uncovered when no enforcing rule matches', async () => {
    const dir = await makeTempRepo()
    await mkdir(join(dir, '.claude'), { recursive: true })
    await writeFile(
      join(dir, '.claude/approvals.yml'),
      'version: 1\nrules:\n  - purpose: Docs only\n    paths: ["docs/**"]\n    verdict: { claude: approves, seats: 0 }\n',
    )
    const policies = await discoverPolicies(dir)
    expect(selectRulesForFile(policies, 'README.md')).toEqual({ decidingPolicy: null, rules: [] })

    await mkdir(join(dir, 'a/.claude'), { recursive: true })
    await mkdir(join(dir, 'b/.claude'), { recursive: true })
    const sibling =
      'version: 1\nrules:\n  - purpose: Sib\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n'
    await writeFile(join(dir, 'b/.claude/approvals.yml'), sibling)
    await writeFile(join(dir, 'a/.claude/approvals.yml'), sibling)
    const sorted = await discoverPolicies(dir)
    expect(sorted.map((p) => p.path)).toEqual([
      '.claude/approvals.yml',
      'a/.claude/approvals.yml',
      'b/.claude/approvals.yml',
    ])
  })
})
