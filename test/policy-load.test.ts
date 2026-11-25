import { describe, expect, it } from 'vitest'
import { parsePolicySource } from '../src/policy/load.js'
import { POLICY_LIMITS, PolicyLoadError } from '../src/policy/types.js'

function expectLoadError(source: string, match: string, opts = {}): void {
  try {
    parsePolicySource(source, opts)
    expect.unreachable('Expected PolicyLoadError')
  } catch (err) {
    expect(err).toBeInstanceOf(PolicyLoadError)
    expect((err as PolicyLoadError).message).toContain(match)
  }
}

describe('policy loader and validator', () => {
  it('loads locals, use maps, reuse, findings, advisory, and max_age', () => {
    const policy = parsePolicySource(`
version: 1
mode: enforce
nested: overwrite
run: parallel
locals:
  docs_paths:
    - 'docs/**'
  ignored:
    - 'docs/drafts/**'
  base_rule:
    verdict:
      claude: comments
      seats:
        - count: 1
          from:
            - humans
            - '!pr/authors'
      max_age: 7d
    reuse:
      seats: 'claude/diff <= same_intent'
      claude/code_review: 'claude/diff <= trivial'
  deep_call: 'claude/code_review(level=deep)'
rules:
  - purpose: Docs rule using locals and findings
    use:
      - '@base_rule'
    paths:
      - '@docs_paths'
      - '!@ignored'
    advisory:
      - 'repo/risk(rigor=fast)'
    findings:
      resolution:
        claude/code_review:
          - if: 'finding/severity >= high'
            from:
              - example-org/leads
              - '!pr/authors'
          - from: nobody
    override:
      - if: '@deep_call = pass AND @deep_call.severity <= low'
        purpose: Fast path
        verdict:
          claude: approves
          seats: 0
          max_age: unset
        reuse: unset
        findings:
          resolution: unset
  - purpose: Guard rule without verdict
    paths:
      - 'src/**'
    findings:
      resolution: humans
`)
    expect(policy.version).toBe(1)
    expect(policy.effectiveObserve).toBe(false)
    expect(policy.rules).toHaveLength(2)
    expect(policy.rules[0]!.paths).toEqual(['docs/**', '!docs/drafts/**'])
    expect(policy.rules[0]!.override).toHaveLength(1)
    expect(policy.rules[0]!.advisory).toHaveLength(1)
  })

  it('refuses unknown keys, duplicate keys, wrong types, and invalid version', () => {
    expectLoadError('version: "1"\nrules: []\n', 'integer 1')
    expectLoadError('version: 1\nextra: true\nrules: []\n', "Unknown key 'extra'")
    expectLoadError('version: 1\nversion: 1\nrules: []\n', 'unique')
    expectLoadError('- not-a-map\n', 'YAML mapping')
    expectLoadError('version: 1\nrules: not-a-list\n', 'must be a list')
    expectLoadError('version: 1\nmode: invalid\nrules: []\n', 'Expected one of')
    expectLoadError('version: 1\nlocals: nope\nrules: []\n', 'locals must be a mapping')
  })

  it('refuses invalid verdicts, seats, max_age, overrides, reuse, findings, and advisory', () => {
    expectLoadError(
      'version: 1\nrules:\n  - purpose: bad\n    paths: ["**"]\n    verdict:\n      claude: blocks\n      seats: 1\n',
      'not allowed beside',
    )
    expectLoadError(
      'version: 1\nrules:\n  - purpose: bad\n    paths: ["**"]\n    verdict:\n      claude: blocks\n    override:\n      - if: "true"\n        verdict:\n          claude: approves\n',
      'must write seats',
    )
    expectLoadError(
      'version: 1\nrules:\n  - purpose: bad\n    paths: ["**"]\n    verdict:\n      claude: approves\n      seats: 20\n',
      'from 0 to 16',
    )
    expectLoadError(
      'version: 1\nrules:\n  - purpose: bad\n    paths: ["**"]\n    verdict:\n      claude: approves\n      seats:\n        - count: 2\n          from: [alice]\n',
      'exceeds number of logins',
    )
    expectLoadError(
      'version: 1\nrules:\n  - purpose: bad\n    paths: ["**"]\n    verdict:\n      claude: approves\n      seats: 0\n      max_age: 30s\n',
      'between 1m and 83d',
    )
    expectLoadError(
      'version: 1\nrules:\n  - purpose: bad\n    paths: ["**"]\n    verdict:\n      claude: approves\n      seats: 0\n    reuse:\n      repo/x: "repo/x = pass"\n',
      'cannot reference itself',
    )
    expectLoadError(
      'version: 1\nrules:\n  - purpose: bad\n    paths: ["**"]\n    verdict:\n      claude: approves\n      seats: 0\n    reuse:\n      claude: "claude/diff <= trivial"\n',
      "Invalid reuse key 'claude'",
    )
    expectLoadError(
      'version: 1\nrules:\n  - purpose: bad\n    paths: ["**"]\n    verdict:\n      claude: approves\n      seats: 0\n    findings:\n      resolution:\n        claude/diff: humans\n',
      'Invalid findings classifier key',
    )
    expectLoadError(
      'version: 1\nrules:\n  - purpose: bad\n    paths: ["**"]\n    verdict:\n      claude: approves\n      seats: 0\n    findings:\n      resolution:\n        - from: humans\n        - if: "finding/severity >= high"\n          from: nobody\n',
      'only allowed last',
    )
    expectLoadError(
      'version: 1\nrules:\n  - purpose: bad\n    paths: ["**"]\n    advisory: ["repo/x.score"]\n    verdict:\n      claude: approves\n      seats: 0\n',
      'must not include an output',
    )
    expectLoadError(
      'version: 1\nrules:\n  - purpose: no verdict\n    paths: ["**"]\n',
      'Rule without verdict',
    )
  })

  it('enforces file and structural limits', () => {
    expectLoadError('x'.repeat(POLICY_LIMITS.maxFileBytes + 1), 'exceeds')
    const manyPaths = Array.from({ length: 257 }, (_, i) => `f${i}.ts`)
    expectLoadError(
      `version: 1\nrules:\n  - purpose: many\n    paths: ${JSON.stringify(manyPaths)}\n    verdict: { claude: approves, seats: 0 }\n`,
      '256 patterns',
    )
    const manyOverrides = Array.from({ length: 17 }, () => ({
      if: 'true',
      verdict: { claude: 'approves', seats: 0 },
    }))
    expectLoadError(
      `version: 1\nrules:\n  - purpose: many\n    paths: ["**"]\n    verdict: { claude: comments, seats: 1 }\n    override: ${JSON.stringify(manyOverrides)}\n`,
      'maximum of 16',
    )
    const manyClassifiers = Array.from({ length: 17 }, (_, i) => `repo/c${i}`)
    expectLoadError(
      `version: 1\nrules:\n  - purpose: many\n    paths: ["**"]\n    advisory: ${JSON.stringify(manyClassifiers)}\n    verdict: { claude: approves, seats: 0 }\n`,
      '16 repo classifiers',
    )
  })
})
