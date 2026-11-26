import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { runCli, type CliIo } from '../src/cli/run.js'
import { selectRulesForFile } from '../src/policy/discover.js'
import { evaluatePolicies } from '../src/policy/evaluate.js'
import { loadLayeredPolicies } from '../src/policy/layers.js'
import { parsePolicySource } from '../src/policy/load.js'
import { PolicyLoadError, type EvaluationFacts } from '../src/policy/types.js'

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/policies/${name}`, import.meta.url))
const supervisorDir = fixture('layered/supervisor')
const SUPERVISOR_FILE = 'supervisor:.claude/approvals.yml'

const reviewed: EvaluationFacts = {
  repository: 'example-org/example-repo',
  openedBy: 'example-dev',
  authors: ['example-dev'],
  approvedBy: ['bot:example-reviewer'],
}
const dependencyBot: EvaluationFacts = {
  ...reviewed,
  openedBy: 'bot:dependabot',
  authors: ['bot:dependabot'],
}

async function cli(argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = {
    env: {},
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    startMcp: vi.fn(async () => undefined),
    runProcess: vi.fn(),
    now: () => new Date(0),
  }
  const code = await runCli(argv, io)
  return { code, stdout: out.join(''), stderr: err.join('') }
}

describe('supervisor policy above a repository policy', () => {
  it('root only: the supervisor policy decides for a repository with no file of its own', async () => {
    const policies = await loadLayeredPolicies(supervisorDir, fixture('layered/repo-plain'))

    expect(policies.map((p) => p.path)).toEqual([SUPERVISOR_FILE])
    expect(policies[0]!.supervisorRoot).toBe(true)
    const selected = selectRulesForFile(policies, 'src/index.ts')
    expect(selected.decidingPolicy?.path).toBe(SUPERVISOR_FILE)
    expect(selected.rules.map((r) => r.sourceFile)).toEqual([SUPERVISOR_FILE])

    const byPerson = evaluatePolicies(policies, { changedFiles: ['src/index.ts'], facts: reviewed })
    expect(byPerson.nextStep.action).toBe('escalate')
    const byBot = evaluatePolicies(policies, {
      changedFiles: ['src/index.ts'],
      facts: dependencyBot,
    })
    expect(byBot.nextStep).toEqual({ action: 'merge' })
  })

  it('root plus repository files: the nearest file decides and inherits the root locals', async () => {
    const policies = await loadLayeredPolicies(supervisorDir, fixture('layered/repo-carve-out'))

    expect(policies.map((p) => p.path)).toEqual([
      SUPERVISOR_FILE,
      '.supervisor/approvals.yml',
      'packages/app/.supervisor/approvals.yml',
    ])
    const docs = selectRulesForFile(policies, 'docs/guide.md')
    expect(docs.decidingPolicy?.path).toBe('.supervisor/approvals.yml')
    expect(docs.rules.map((r) => r.purpose)).toEqual(['Docs merge once the reviewer approves.'])

    const merge = { action: 'merge' }
    const check = (file: string, facts: EvaluationFacts) =>
      evaluatePolicies(policies, { changedFiles: [file], facts })
    expect(check('docs/guide.md', reviewed).nextStep).toEqual(merge)
    expect(check('docs/guide.md', { ...reviewed, approvedBy: [] }).nextStep.action).toBe('escalate')
    expect(check('packages/app/src/a.ts', reviewed).nextStep).toEqual(merge)

    // No repository rule matches these, so the supervisor policy still decides for them.
    for (const file of ['src/index.ts', 'packages/app/README.md']) {
      expect(selectRulesForFile(policies, file).decidingPolicy?.path).toBe(SUPERVISOR_FILE)
      expect(check(file, reviewed).nextStep.action).toBe('escalate')
    }
  })

  it('a repository file cannot remove an inherited rule', async () => {
    const policies = await loadLayeredPolicies(supervisorDir, fixture('layered/repo-carve-out'))

    const selected = selectRulesForFile(policies, '.github/workflows/ci.yml')
    expect(selected.decidingPolicy?.path).toBe('.supervisor/approvals.yml')
    expect(selected.rules.map((r) => r.purpose)).toEqual([
      'This repository tries to let CI workflows merge unreviewed.',
      'CI workflows, release and signing always go to a person.',
    ])
    const result = evaluatePolicies(policies, {
      changedFiles: ['.github/workflows/ci.yml'],
      facts: dependencyBot,
    })
    expect(result.verdict).toBe('comments')
    expect(result.nextStep.action).toBe('escalate')
  })

  it('a change to a policy file goes to a person unless a rule approves it', async () => {
    const policies = await loadLayeredPolicies(supervisorDir, fixture('layered/repo-carve-out'))
    for (const file of ['.supervisor/approvals.yml', 'packages/app/.supervisor/approvals.yml']) {
      const result = evaluatePolicies(policies, {
        changedFiles: ['package.json', file],
        facts: dependencyBot,
      })
      expect(result.verdict).toBe('comments')
      expect(result.nextStep.action).toBe('escalate')
    }

    const rule = (paths: string) =>
      parsePolicySource(
        `version: 1\nrules:\n  - purpose: Approve\n    paths: ${paths}\n    verdict: { claude: approves, seats: 0 }\n`,
      )
    const policyFiles = [
      '.supervisor/approvals.yml',
      'packages/app/.claude/approvals.yml',
      '.claude/classifiers/flake_fix/def.yml',
    ]
    for (const file of policyFiles) {
      const changedFiles = ['src/a.ts', file]
      const uncovered = evaluatePolicies([rule("['src/**']")], { changedFiles })
      expect(uncovered.uncoveredFiles).toEqual([file])
      expect(uncovered.nextStep.action).toBe('escalate')
      expect(evaluatePolicies([rule("['**']")], { changedFiles }).nextStep.action).toBe('merge')
    }
  })

  it('refuses a supervisor-only fact in a repository policy, naming the file', async () => {
    const load = loadLayeredPolicies(supervisorDir, fixture('layered/repo-supervisor-fact'))
    await expect(load).rejects.toThrow(PolicyLoadError)
    const { errors } = (await load.catch((err: unknown) => err)) as PolicyLoadError

    expect(errors.map((e) => e.file)).toEqual([
      '.supervisor/approvals.yml',
      '.supervisor/approvals.yml',
    ])
    expect(errors[0]!.message).toContain("'pr/repository' is only allowed in supervisor policies")
    expect(errors[1]!.message).toContain("'pr/labels' is only allowed in supervisor policies")
  })

  it('refuses a supervisor directory with no root file or with directory files', async () => {
    const repoDir = fixture('layered/repo-plain')
    await expect(loadLayeredPolicies(repoDir, repoDir)).rejects.toThrow(
      'has no .claude/approvals.yml',
    )
    await expect(
      loadLayeredPolicies(fixture('layered/supervisor-nested'), repoDir),
    ).rejects.toThrow('supervisor:packages/app/.claude/approvals.yml')
  })

  it('policy check and explain take --repo-dir', async () => {
    const repoDir = fixture('layered/repo-carve-out')
    const input = fixture('inputs/layered-docs.json')
    const base = ['policy', 'check', '--dir', supervisorDir, '--input', input]

    const merged = await cli([...base, '--repo-dir', repoDir])
    expect(merged.code).toBe(0)
    expect(merged.stdout).toContain('Next step: merge allowed')
    const rootOnly = await cli([...base, '--supervisor-policy'])
    expect(rootOnly.code).toBe(1)
    expect((await cli([...base, '--repo-dir'])).code).toBe(2)
    const refused = await cli([...base, '--repo-dir', fixture('layered/repo-supervisor-fact')])
    expect(refused.code).toBe(2)
    expect(refused.stderr).toContain('.supervisor/approvals.yml:rules[0].if')

    const overview = await cli(['policy', 'explain', supervisorDir, '--repo-dir', repoDir])
    expect(overview.code).toBe(0)
    expect(overview.stdout).toContain(SUPERVISOR_FILE)
    expect(overview.stdout).toContain('packages/app/.supervisor/approvals.yml')
    const targeted = await cli([
      'policy',
      'explain',
      '--repo-dir',
      repoDir,
      supervisorDir,
      'docs/guide.md',
    ])
    expect(targeted.stdout).toContain('Deciding policy: .supervisor/approvals.yml')
    const incomplete = await cli(['policy', 'explain', supervisorDir, '--repo-dir'])
    expect(incomplete.code).toBe(2)
    expect(incomplete.stderr).toContain('--repo-dir <checkout>')
  })
})
