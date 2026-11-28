import { describe, expect, it } from 'vitest'
import { validatePr } from '../src/pr/validate.js'
import { VALID_BODY, VALID_COMMENT, VALID_TITLE } from './helpers/pr.js'

function rules(body: string): string[] {
  const result = validatePr({
    title: VALID_TITLE,
    body,
    provenanceComment: VALID_COMMENT,
    extraFields: ['machine'],
  })
  return result.errors.map((e) => e.rule)
}

describe('validatePr HTML comments', () => {
  it('accepts a body with visible sections', () => {
    expect(rules(VALID_BODY)).toEqual([])
  })

  it('ignores headings inside a multi-line HTML comment', () => {
    const hidden = '<!--\n## Problem\nHidden.\n## Change\nHidden.\n## Verification\nHidden.\n-->'
    expect(rules(hidden)).toEqual(['section-problem', 'section-change', 'section-verification'])
  })

  it('ignores a fence marker inside a comment and keeps text around inline comments', () => {
    const body = `<!-- start\n\`\`\`\nend --> x <!-- y --> z\n${VALID_BODY}`
    expect(rules(body)).toEqual([])
  })

  it('keeps comment markers inside fenced code', () => {
    const body = `${VALID_BODY}\n\n\`\`\`\n<!--\n\`\`\`\n`
    expect(rules(body)).toEqual([])
  })
})
