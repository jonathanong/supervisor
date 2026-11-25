import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadPolicyFile, parsePolicySource } from '../src/policy/load.js'
import { POLICY_LIMITS, PolicyLoadError } from '../src/policy/types.js'

function expectErr(source: string, match: string): void {
  try {
    parsePolicySource(source)
    expect.unreachable(`Expected error matching '${match}'`)
  } catch (err) {
    expect(err).toBeInstanceOf(PolicyLoadError)
    expect((err as PolicyLoadError).message).toContain(match)
  }
}

describe('policy extras and file-level limit errors', () => {
  it('validates advisory, overrides, reuse, findings, and file-level limits', async () => {
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    advisory: not-list\n    verdict: { claude: approves, seats: 0 }\n',
      'advisory must be a list',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    advisory: [123, "pr/base"]\n    verdict: { claude: approves, seats: 0 }\n',
      'advisory item must be a string',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    override: not-list\n    verdict: { claude: approves, seats: 0 }\n',
      'override must be a list',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    override: [123, {}, { if: true }]\n    verdict: { claude: approves, seats: 0 }\n',
      'override.if is required',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    findings: 123\n    verdict: { claude: approves, seats: 0 }\n',
      'findings must be an object',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    findings: {}\n    verdict: { claude: approves, seats: 0 }\n',
      'findings.resolution is required',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    findings: { resolution: {} }\n    verdict: { claude: approves, seats: 0 }\n',
      'must not be empty',
    )
    const seventeenSets = Array.from({ length: 17 }, () => ({
      if: 'finding/severity >= high',
      from: 'humans',
    }))
    expectErr(
      `version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    findings: { resolution: ${JSON.stringify(seventeenSets)} }\n    verdict: { claude: approves, seats: 0 }\n`,
      '16 sets',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    findings: { resolution: [{ from: humans }, "alice"] }\n    verdict: { claude: approves, seats: 0 }\n',
      'Cannot mix',
    )

    const tooManyLocals = Object.fromEntries(
      Array.from({ length: POLICY_LIMITS.maxLocalsPerFile + 1 }, (_, i) => [`k${i}`, i]),
    )
    expectErr(`version: 1\nlocals: ${JSON.stringify(tooManyLocals)}\nrules: []\n`, 'maximum of 512')
    const tooManyRules = Array.from({ length: POLICY_LIMITS.maxRulesPerFile + 1 }, (_, i) => ({
      purpose: `r${i}`,
      paths: ['**'],
      verdict: { claude: 'approves', seats: 0 },
    }))
    expectErr(`version: 1\nrules: ${JSON.stringify(tooManyRules)}\n`, 'maximum of 512')
    const tooManyFileOverrides = Array.from({ length: 9 }, (_, i) => ({
      purpose: `r${i}`,
      paths: ['**'],
      verdict: { claude: 'comments', seats: 1 },
      override: Array.from({ length: 15 }, () => ({
        if: 'true',
        verdict: { claude: 'approves', seats: 0 },
      })),
    }))
    expectErr(`version: 1\nrules: ${JSON.stringify(tooManyFileOverrides)}\n`, 'exceeds 128')
    const tooManyRuns = Array.from({ length: 33 }, () => 'repo/r1')
    expectErr(
      `version: 1\nrules:\n  - purpose: runs\n    paths: ["**"]\n    advisory: ${JSON.stringify(tooManyRuns)}\n    verdict: { claude: approves, seats: 0 }\n`,
      '32 repo classifier runs',
    )

    expectErr(
      'version: 1\nrules:\n  - purpose: 123\n    paths: ["**"]\n    override: [{ if: 123, verdict: { claude: approves, seats: 0 } }]\n    verdict: { claude: approves, seats: 0 }\n',
      'single non-empty line',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: bad\n    paths: ["**"]\n    reuse: { seats: "claude/diff <= trivial" }\n',
      'Rule without verdict',
    )
    expectErr(
      'version: 1\nlocals: { mixed: [1, { a: 2 }] }\nrules:\n  - purpose: bad\n    if: "@mixed = 1"\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n',
      'cannot be used in a condition',
    )
    expect(
      parsePolicySource(
        'version: 1\nrules:\n  - purpose: bare at\n    if: "pr/base = @ "\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n',
      ).rules,
    ).toHaveLength(1)

    const reuseOnly = parsePolicySource(`
version: 1
rules:
  - purpose: Classifier reuse only
    paths: ['src/**']
    reuse:
      claude/code_review: 'claude/diff <= trivial'
`)
    expect(reuseOnly.rules[0]!.verdict).toBeUndefined()

    const loaded = await loadPolicyFile(
      fileURLToPath(
        new URL('./fixtures/policies/docs-light/.claude/approvals.yml', import.meta.url),
      ),
    )
    expect(loaded.version).toBe(1)
  })
})
