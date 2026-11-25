import { describe, expect, it } from 'vitest'
import { parseCondition } from '../src/policy/condition-parser.js'
import { evaluateCondition, type EvalContext } from '../src/policy/conditions.js'

const baseCtx: EvalContext = {
  facts: {
    filesChanged: 3,
    filesAdded: 2,
    filesRemoved: 1,
    diffLines: 45,
    authors: ['alice', 'bob'],
    approvedBy: ['carol'],
    openedBy: 'alice',
    base: 'release/1.2',
    repository: 'jonathanong/supervisor',
    labels: ['docs', 'auto'],
    teams: { 'example-org/security': ['carol'] },
    bots: ['bot:renovate'],
  },
  ruleFacts: { filesChanged: 2, filesAdded: 1, filesRemoved: 0 },
  classifiers: {
    'claude/code_review': { status: 'complete', value: 'pass', level: 'deep', severity: 'low' },
    'claude/diff': { status: 'complete', value: 'same_intent' },
    'repo/risk@2': {
      status: 'complete',
      value: 'low',
      outputs: { score: 2, tier: 'low' },
      severity: 'minimal',
    },
  },
}

describe('policy condition evaluation', () => {
  it('evaluates numeric, scalar, list, and logical expressions', () => {
    expect(evaluateCondition(parseCondition('true'), baseCtx)).toBe('true')
    expect(evaluateCondition(parseCondition('false'), baseCtx)).toBe('false')
    expect(
      evaluateCondition(parseCondition('pr/files_changed <= 5 AND pr/diff_lines < 100'), baseCtx),
    ).toBe('true')
    expect(
      evaluateCondition(parseCondition('pr/files_added > 1 AND pr/files_removed >= 1'), baseCtx),
    ).toBe('true')
    expect(
      evaluateCondition(
        parseCondition(
          'rule/files_changed = 2 AND rule/files_added != 0 AND rule/files_removed = 0',
        ),
        baseCtx,
      ),
    ).toBe('true')
    expect(
      evaluateCondition(parseCondition('rule/files_changed < pr/files_changed'), baseCtx),
    ).toBe('true')
    expect(
      evaluateCondition(
        parseCondition("(pr/base = 'release/**' OR pr/base = 'main') AND pr/opened_by = 'alice'"),
        baseCtx,
      ),
    ).toBe('true')
    expect(
      evaluateCondition(
        parseCondition("pr/base != 'hotfix/**' AND pr/opened_by != 'bob'"),
        baseCtx,
      ),
    ).toBe('true')
    expect(evaluateCondition(parseCondition("ANY pr/authors = ['bob', '!alice']"), baseCtx)).toBe(
      'true',
    )
    expect(evaluateCondition(parseCondition('ALL pr/authors = humans'), baseCtx)).toBe('true')
    expect(evaluateCondition(parseCondition('ALL pr/authors != bots'), baseCtx)).toBe('true')
    expect(
      evaluateCondition(parseCondition('ANY pr/approved_by = example-org/security'), baseCtx),
    ).toBe('true')
    expect(evaluateCondition(parseCondition('pr/approved_by != empty'), baseCtx)).toBe('true')
    expect(
      evaluateCondition(parseCondition('pr/approved_by = empty'), {
        ...baseCtx,
        facts: { approvedBy: [] },
      }),
    ).toBe('true')
    expect(
      evaluateCondition(parseCondition('ANY pr/authors = humans'), {
        ...baseCtx,
        facts: { authors: [] },
      }),
    ).toBe('false')
    expect(
      evaluateCondition(parseCondition('ALL pr/authors != humans'), {
        ...baseCtx,
        facts: { authors: [] },
      }),
    ).toBe('true')
  })

  it('evaluates classifiers, severity, levels, diff, and missing/error/incomplete results', () => {
    expect(
      evaluateCondition(parseCondition('claude/code_review(level=deep) = pass'), baseCtx),
    ).toBe('true')
    expect(
      evaluateCondition(parseCondition('claude/code_review.severity <= medium'), baseCtx),
    ).toBe('true')
    expect(
      evaluateCondition(
        parseCondition('claude/diff <= same_intent', { allowReuseOnly: true }),
        baseCtx,
      ),
    ).toBe('true')
    expect(
      evaluateCondition(
        parseCondition('repo/risk@2(mode=fast, tags=[a, b], depth=3).score <= 5'),
        baseCtx,
      ),
    ).toBe('true')
    expect(evaluateCondition(parseCondition('repo/risk@2.tier = [low, medium]'), baseCtx)).toBe(
      'true',
    )
    expect(evaluateCondition(parseCondition("repo/risk@2.tier != 'high'"), baseCtx)).toBe('true')
    expect(evaluateCondition(parseCondition('repo/risk@2 = low'), baseCtx)).toBe('true')

    const shallowCtx: EvalContext = {
      ...baseCtx,
      classifiers: { 'claude/code_review': { status: 'complete', value: 'pass', level: 'quick' } },
    }
    expect(
      evaluateCondition(parseCondition('claude/code_review(level=deep) = pass'), shallowCtx),
    ).toBe('unknown')

    const errCtx: EvalContext = {
      ...baseCtx,
      classifiers: {
        'claude/code_review': { status: 'error' },
        'repo/x': { status: 'incomplete' },
      },
    }
    expect(evaluateCondition(parseCondition('claude/code_review = error'), errCtx)).toBe('true')
    expect(evaluateCondition(parseCondition('claude/code_review = pass'), errCtx)).toBe('unknown')
    expect(evaluateCondition(parseCondition('repo/x = incomplete'), errCtx)).toBe('true')
    expect(evaluateCondition(parseCondition('claude/code_review = pass AND false'), errCtx)).toBe(
      'false',
    )
    expect(evaluateCondition(parseCondition('claude/code_review = pass OR true'), errCtx)).toBe(
      'true',
    )
    expect(evaluateCondition(parseCondition('claude/code_review = pass AND true'), errCtx)).toBe(
      'unknown',
    )
    expect(evaluateCondition(parseCondition('claude/code_review = pass OR false'), errCtx)).toBe(
      'unknown',
    )
    expect(
      evaluateCondition(parseCondition('repo/missing = pass'), { ...baseCtx, classifiers: {} }),
    ).toBe('unknown')
  })

  it('supports supervisor-only pr/repository and pr/labels only when enabled', () => {
    expect(() => parseCondition("pr/repository = 'jonathanong/*'")).toThrow('supervisor policies')
    expect(() => parseCondition("ANY pr/labels = 'docs'")).toThrow('supervisor policies')

    const repoExpr = parseCondition(
      "pr/repository = 'jonathanong/*' AND ANY pr/labels = ['docs']",
      {
        supervisorPolicy: true,
      },
    )
    expect(evaluateCondition(repoExpr, baseCtx)).toBe('true')
    expect(
      evaluateCondition(
        parseCondition("ALL pr/labels != 'blocked'", { supervisorPolicy: true }),
        baseCtx,
      ),
    ).toBe('true')
  })

  // TODO(spec): confirm whether supervisor-only `pr/labels` also accepts a bare `pr/labels = 'docs'` form without ANY/ALL.
  it.skip('allows bare pr/labels without ANY/ALL in supervisor policy', () => {
    const expr = parseCondition("pr/labels = 'docs'", { supervisorPolicy: true })
    expect(evaluateCondition(expr, baseCtx)).toBe('true')
  })

  // TODO(spec): validate repo/<name>.<output> operators against def.yml output types when classifier defs are loaded.
  it.skip('refuses ordering operator on criteria output from def.yml', () => {
    expect(() => parseCondition('repo/risk.tier <= high')).toThrow()
  })
})
