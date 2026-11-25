import { describe, expect, it } from 'vitest'
import { parseClassifierRef, parseCondition } from '../src/policy/condition-parser.js'
import { extractClassifierCalls } from '../src/policy/condition-validate.js'

describe('policy condition parser errors and refs', () => {
  it('rejects invalid syntax, operators, and limits', () => {
    expect(() => parseCondition("pr/base = 'unterminated")).toThrow('Unterminated')
    expect(() => parseCondition('pr/files_changed $ 1')).toThrow('Unexpected character')
    expect(() => parseCondition('true AND false OR true')).toThrow('Cannot mix')
    expect(() => parseCondition('NOT true')).toThrow('NOT')
    expect(() => parseCondition('(((((((((true)))))))))')).toThrow('Parenthesis')
    expect(() => parseCondition('(true')).toThrow("Expected ')'")
    expect(() => parseCondition('true false')).toThrow('Unexpected token')
    expect(() => parseCondition('pr/authors = bots')).toThrow('ANY or ALL')
    expect(() => parseCondition('ANY pr/approved_by = empty')).toThrow('must not use ANY or ALL')
    expect(() => parseCondition('ANY pr/files_changed = 1')).toThrow('Quantifier')
    expect(() => parseCondition('ANY pr/opened_by = humans')).toThrow('Quantifier')
    expect(() => parseCondition('ANY claude/code_review = pass')).toThrow('Quantifier')
    expect(() => parseCondition('pr/files_changed = humans')).toThrow('number or count fact')
    expect(() => parseCondition("pr/base < 'main'")).toThrow('not valid')
    expect(() => parseCondition('ANY pr/authors < humans')).toThrow('not valid')
    expect(() => parseCondition('pr/unknown = 1')).toThrow('Unknown fact')
    expect(() => parseCondition('claude/code_review != error')).toThrow("only supports '='")
    expect(() => parseCondition('claude/code_review = error', { allowReuseOnly: true })).toThrow(
      'not allowed in reuse',
    )
    expect(() => parseCondition('claude/diff <= trivial')).toThrow('only allowed in reuse')
    expect(() => parseCondition('claude/diff(x=1) <= trivial', { allowReuseOnly: true })).toThrow(
      'no inputs',
    )
    expect(() => parseCondition('claude/code_review(level=ultra) = pass')).toThrow(
      'Invalid claude/code_review',
    )
    expect(() => parseCondition('claude/code_review.other = pass')).toThrow(
      'Unknown claude/code_review',
    )
    expect(() => parseCondition('claude/code_review < pass')).toThrow('Operator not allowed')
    expect(() => parseCondition('finding/severity >= high')).toThrow('findings.resolution')
    expect(() =>
      parseCondition('finding/severity < minimal', { allowFindingSeverity: true }),
    ).toThrow('Impossible')
    expect(() => parseCondition('repo/x@0 = pass')).toThrow('Invalid classifier version')
    expect(() => parseCondition('x'.repeat(5000))).toThrow('maximum length')
    expect(() => parseClassifierRef('pr/base')).toThrow('Expected classifier reference')
  })

  it('parses classifier refs and extracts calls from logical expressions', () => {
    const call = parseClassifierRef('claude/code_review(level=quick)')
    expect(call).toEqual({ name: 'claude/code_review', inputs: { level: 'quick' } })
    expect(
      extractClassifierCalls(parseCondition('true AND claude/code_review = pass')),
    ).toHaveLength(1)
  })
})
