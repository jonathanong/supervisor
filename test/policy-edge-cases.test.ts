import { describe, expect, it } from 'vitest'
import { parseCondition } from '../src/policy/condition-parser.js'
import { evaluateCondition, type EvalContext } from '../src/policy/conditions.js'
import { accountMatchesList } from '../src/policy/people.js'

const emptyCtx: EvalContext = {
  facts: {},
  ruleFacts: { filesChanged: 0, filesAdded: 0, filesRemoved: 0 },
  classifiers: {},
}

describe('policy condition and people edge cases', () => {
  it('covers tokenizer escapes, parser syntax errors, and people matching', () => {
    expect(
      evaluateCondition(parseCondition("pr/base = 'a\\'b'"), {
        ...emptyCtx,
        facts: { base: "a'b" },
      }),
    ).toBe('true')
    expect(() => parseCondition('pr/base 1')).toThrow('Expected comparison operator')
    expect(() => parseCondition('123 = 1')).toThrow('Expected fact or classifier')
    expect(() => parseCondition('repo/x(1=2) = pass')).toThrow("Expected 'key=value'")
    expect(() => parseCondition('repo/x(a=1 b=2) = pass')).toThrow("Expected ',' or ')'")
    expect(() => parseCondition('repo/x.123 = pass')).toThrow('Expected output name')
    expect(() => parseCondition('repo/x(a=) = pass')).toThrow('Invalid classifier input value')
    expect(() => parseCondition('pr/base = )')).toThrow('Expected right-hand value')
    expect(() => parseCondition('pr/base = [=]')).toThrow('Unexpected list item')
    expect(() => parseCondition('pr/base = [a b]')).toThrow("Expected ',' or ']'")
    const longList = Array.from({ length: 1025 }, () => 'a').join(',')
    expect(() => parseCondition(`pr/base = [${longList}]`)).toThrow('max entries')
    expect(() =>
      parseCondition('ANY finding/severity = high', { allowFindingSeverity: true }),
    ).toThrow('Quantifier')
    expect(() =>
      parseCondition('finding/severity = bogus', { allowFindingSeverity: true }),
    ).toThrow('valid severity')
    expect(() =>
      parseCondition('finding/severity > critical', { allowFindingSeverity: true }),
    ).toThrow('Impossible')

    expect(accountMatchesList('alice', ['everyone'], {})).toBe(true)
    expect(accountMatchesList('alice', ['pr/authors'], { authors: ['alice'] })).toBe(true)
    expect(accountMatchesList('alice', ['pr/opened_by'], { openedBy: 'alice' })).toBe(true)
    expect(accountMatchesList('alice', ['org/missing'], {})).toBe(false)
  })

  it('returns unknown on absent facts, missing severity/level/diff/output, and logical fallbacks', () => {
    expect(evaluateCondition(parseCondition('pr/files_changed = 1'), emptyCtx)).toBe('unknown')
    expect(evaluateCondition(parseCondition("pr/base = 'main'"), emptyCtx)).toBe('unknown')
    expect(evaluateCondition(parseCondition("pr/opened_by = 'a'"), emptyCtx)).toBe('unknown')
    expect(evaluateCondition(parseCondition('pr/approved_by = empty'), emptyCtx)).toBe('unknown')
    expect(evaluateCondition(parseCondition('ANY pr/authors = humans'), emptyCtx)).toBe('unknown')
    expect(
      evaluateCondition(parseCondition('claude/code_review(level=quick) = pass'), {
        ...emptyCtx,
        classifiers: { 'claude/code_review': { status: 'complete', value: 'pass' } },
      }),
    ).toBe('unknown')
    expect(
      evaluateCondition(parseCondition('claude/code_review.severity <= bogus'), {
        ...emptyCtx,
        classifiers: { 'claude/code_review': { status: 'complete', severity: 'low' } },
      }),
    ).toBe('unknown')
    expect(
      evaluateCondition(parseCondition('claude/code_review.severity <= low'), {
        ...emptyCtx,
        classifiers: { 'claude/code_review': { status: 'complete' } },
      }),
    ).toBe('unknown')
    expect(
      evaluateCondition(parseCondition('claude/diff <= bogus', { allowReuseOnly: true }), {
        ...emptyCtx,
        classifiers: { 'claude/diff': { status: 'complete', value: 'trivial' } },
      }),
    ).toBe('unknown')
    expect(
      evaluateCondition(parseCondition('claude/diff <= trivial', { allowReuseOnly: true }), {
        ...emptyCtx,
        classifiers: { 'claude/diff': { status: 'complete', value: 1 } },
      }),
    ).toBe('unknown')
    expect(
      evaluateCondition(parseCondition('repo/x.out = 1'), {
        ...emptyCtx,
        classifiers: { 'repo/x': { status: 'complete', outputs: {} } },
      }),
    ).toBe('unknown')
    expect(
      evaluateCondition(parseCondition('repo/x = 5'), {
        ...emptyCtx,
        classifiers: { 'repo/x': { status: 'complete', value: '5' } },
      }),
    ).toBe('true')
    expect(
      evaluateCondition(parseCondition('repo/x != [a, b]'), {
        ...emptyCtx,
        classifiers: { 'repo/x': { status: 'complete', value: 'c' } },
      }),
    ).toBe('true')
    expect(evaluateCondition(parseCondition('true AND false'), emptyCtx)).toBe('false')
    expect(evaluateCondition(parseCondition('false OR false'), emptyCtx)).toBe('false')

    const falseCtx: EvalContext = {
      facts: { base: 'main', openedBy: 'alice', authors: ['alice'] },
      ruleFacts: { filesChanged: 0, filesAdded: 0, filesRemoved: 0 },
      classifiers: {
        'claude/code_review': {
          status: 'complete',
          value: 'fail',
          level: 'deep',
          severity: 'high',
        },
        'claude/diff': { status: 'complete', value: 'different' },
        'repo/x': { status: 'complete', value: 10, outputs: { tag: 'z' } },
      },
    }
    expect(evaluateCondition(parseCondition('claude/code_review.severity <= low'), falseCtx)).toBe(
      'false',
    )
    expect(
      evaluateCondition(
        parseCondition('claude/diff <= same_intent', { allowReuseOnly: true }),
        falseCtx,
      ),
    ).toBe('false')
    expect(evaluateCondition(parseCondition('repo/x <= 5'), falseCtx)).toBe('false')
    expect(evaluateCondition(parseCondition('repo/x.tag = [a, b]'), falseCtx)).toBe('false')
    expect(evaluateCondition(parseCondition("pr/base = 'release/**'"), falseCtx)).toBe('false')
    expect(evaluateCondition(parseCondition("pr/opened_by = 'bob'"), falseCtx)).toBe('false')
    expect(evaluateCondition(parseCondition("ANY pr/authors = 'bob'"), falseCtx)).toBe('false')
    expect(
      evaluateCondition(parseCondition('pr/approved_by = empty'), {
        ...falseCtx,
        facts: { approvedBy: ['carol'] },
      }),
    ).toBe('false')
  })
})
