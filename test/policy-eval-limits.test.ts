import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli, type CliIo } from '../src/cli/run.js'
import { discoverPolicies } from '../src/policy/discover.js'
import { evaluatePolicies } from '../src/policy/evaluate.js'
import { parsePolicySource } from '../src/policy/load.js'

const tempDirs: string[] = []
async function makeTempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'supervisor-eval-edge-'))
  tempDirs.push(d)
  return d
}

describe('policy evaluation, CLI, and discovery limits', () => {
  afterEach(async () => {
    while (tempDirs.length > 0) await rm(tempDirs.pop()!, { recursive: true, force: true })
  })

  it('covers override max_age, depth comparison, and author fallback', () => {
    const policy = parsePolicySource(`
version: 1
rules:
  - purpose: Multi-depth and max_age
    paths: ['src/**']
    advisory: ['claude/code_review(level=quick)']
    verdict: { claude: comments, seats: 1, max_age: 7d }
    override:
      - if: 'pr/files_changed > 5'
        verdict: { max_age: 24h }
      - if: 'claude/code_review(level=standard) = pass'
        verdict: { max_age: unset }
      - if: 'true'
        verdict: { claude: comments }
  - purpose: Guard without verdict
    paths: ['src/**']
    reuse: false
    findings: { resolution: humans }
`)
    const res1 = evaluatePolicies([policy], {
      changedFiles: ['src/a.ts', 'README.md'],
      facts: { filesChanged: 6 },
    })
    expect(res1.reviewDepth).toBe('standard')
    expect(res1.files[0]!.rules[0]!.verdict.maxAge).toBe('24h')

    const res2 = evaluatePolicies([policy], {
      changedFiles: ['src/a.ts'],
      facts: { authors: ['dev'] },
      classifiers: {
        'claude/code_review': { status: 'complete', value: 'pass', level: 'standard' },
      },
    })
    expect(res2.files[0]!.rules[0]!.verdict.maxAge).toBeUndefined()

    const res3 = evaluatePolicies([policy], {
      changedFiles: ['src/a.ts'],
      classifiers: {
        'claude/code_review': { status: 'complete', value: 'fail', level: 'standard' },
      },
    })
    expect(res3.files[0]!.rules[0]!.verdict.maxAge).toBe('7d')

    const multiDepth = parsePolicySource(`
version: 1
rules:
  - purpose: Deep then quick and default depth
    paths: ['src/**']
    advisory: ['claude/code_review(level=quick)', 'claude/code_review(level=deep)', 'claude/code_review(level=standard)']
    verdict: { claude: approves, seats: 1 }
    override:
      - if: 'claude/code_review = pass'
        verdict: { claude: approves, seats: 0 }
`)
    const dedup = evaluatePolicies([multiDepth], {
      changedFiles: ['src/a.ts', 'src/b.ts'],
      facts: { openedBy: 'dev', authors: ['dev'] },
    })
    expect(dedup.reviewDepth).toBe('deep')
    expect(dedup.authorOnlyWarnings).toHaveLength(1)
    expect(dedup.nextStep).toEqual({ action: 'merge' })

    const defaultDepth = parsePolicySource(`
version: 1
rules:
  - purpose: No explicit level
    paths: ['src/**']
    verdict: { claude: comments, seats: 2 }
    override:
      - if: 'claude/code_review = pass'
        verdict: { claude: approves, seats: 0 }
`)
    expect(evaluatePolicies([defaultDepth], { changedFiles: ['src/a.ts'] }).nextStep).toEqual({
      action: 'request_review',
      depth: 'standard',
    })
  })

  it('covers CLI supervisor-policy flag, uncovered/no-rule formatting, and discovery repo limits', async () => {
    const dir = await makeTempDir()
    await mkdir(join(dir, '.claude'), { recursive: true })
    await writeFile(
      join(dir, '.claude/approvals.yml'),
      `version: 1
rules:
  - purpose: Supervisor policy rule
    paths: ['src/**']
    if: "pr/repository = 'jonathanong/*'"
    verdict: { claude: approves, seats: 0 }
  - purpose: Always a person, which a supervisor policy must have to load
    paths: ['.github/workflows/**', 'release/**', 'signing/**', '**/.supervisor/**', '**/.claude/**']
    nested: inherit
    verdict: { claude: comments, seats: 1 }
  - purpose: Guard rule
    paths: ['src/**']
    findings: { resolution: nobody }
`,
    )
    const inputPath = join(dir, 'in.json')
    await writeFile(
      inputPath,
      JSON.stringify({
        changedFiles: ['README.md', 'src/a.ts'],
        facts: { repository: 'other/repo' },
      }),
    )

    const guardDir = await makeTempDir()
    await mkdir(join(guardDir, '.claude'), { recursive: true })
    await writeFile(
      join(guardDir, '.claude/approvals.yml'),
      `version: 1
rules:
  - purpose: Guard rule
    paths: ['src/**']
    findings: { resolution: nobody }
`,
    )

    const out: string[] = []
    const err: string[] = []
    const io: CliIo = {
      env: {},
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      startMcp: vi.fn(async () => undefined),
      runProcess: vi.fn(),
      shepherdStatus: vi.fn(),
      now: () => new Date(0),
    }
    expect(await runCli(['policy', 'explain', guardDir], io)).toBe(0)
    expect(out.join('')).toContain('no verdict')
    out.length = 0
    expect(await runCli(['policy', 'explain', dir], io)).toBe(2)
    expect(
      await runCli(
        ['policy', 'check', '--dir', dir, '--input', inputPath, '--supervisor-policy'],
        io,
      ),
    ).toBe(1)
    expect(out.join('')).toContain('Uncovered files: README.md')
    expect(out.join('')).toContain('no rule applies')

    const bigDir = await makeTempDir()
    const chunk = `# ${'x'.repeat(380 * 1024)}\nversion: 1\nrules: []\n`
    for (let i = 0; i < 23; i += 1) {
      await mkdir(join(bigDir, `p${i}/.claude`), { recursive: true })
      await writeFile(join(bigDir, `p${i}/.claude/approvals.yml`), chunk)
    }
    await expect(discoverPolicies(bigDir)).rejects.toThrow('maximum total size')

    const manyDir = await makeTempDir()
    const tiny = 'version: 1\nrules: []\n'
    await Promise.all(
      Array.from({ length: 1025 }, async (_, i) => {
        const sub = join(manyDir, `d${Math.floor(i / 50)}/p${i}/.claude`)
        await mkdir(sub, { recursive: true })
        await writeFile(join(sub, 'approvals.yml'), tiny)
      }),
    )
    await expect(discoverPolicies(manyDir)).rejects.toThrow('maximum of 1024')
  })
})
