import { CORE_PROVENANCE_FIELDS } from '../config/provenance.js'
import { createCommentStripper } from './html-comments.js'
import { validateProvenanceComment } from './provenance.js'
import { containsCredential } from './redact.js'

export const VALIDATOR_RULE_IDS = [
  'title-required',
  'title-length',
  'title-no-bare-issue',
  'section-problem',
  'section-change',
  'section-verification',
  'no-credentials',
  'provenance-marker',
  'provenance-format',
  'provenance-harness',
  'provenance-version',
  'provenance-models',
  'provenance-session',
  'provenance-role',
  'provenance-scope-fields',
] as const

export type ValidatorRuleId = (typeof VALIDATOR_RULE_IDS)[number]

export interface ValidationError {
  rule: ValidatorRuleId
  message: string
}

export interface PrValidationResult {
  valid: boolean
  errors: ValidationError[]
  provenanceFields: string[]
  provenanceComment?: string
}

const MAX_TITLE_LENGTH = 72
const BARE_ISSUE_RE =
  /^(?:(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+)?(?:[\w.-]+\/[\w.-]+)?#\d+$/i
const CLOSING_ISSUE_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:([\w.-]+\/[\w.-]+))?#([1-9]\d{0,9})\b/gi
const HEADING_RE = /^##\s+(.+?)\s*$/

const REQUIRED_SECTIONS: ReadonlyArray<{ heading: string; rule: ValidatorRuleId }> = [
  { heading: 'problem', rule: 'section-problem' },
  { heading: 'change', rule: 'section-change' },
  { heading: 'verification', rule: 'section-verification' },
]

/** Removes fenced code blocks (backtick or tilde) so headings or issue refs inside them are ignored. */
export function stripCodeFences(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let fenceChar = ''
  let fenceLen = 0
  for (const line of lines) {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceChar === '') {
      if (match) {
        fenceChar = match[1]![0]!
        fenceLen = match[1]!.length
      } else {
        out.push(line)
      }
    } else if (
      match &&
      match[1]![0] === fenceChar &&
      match[1]!.length >= fenceLen &&
      line.trim() === match[1]!
    ) {
      fenceChar = ''
      fenceLen = 0
    }
  }
  return out.join('\n')
}

function parseSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string[]>()
  let current: string | undefined
  let fenceChar = ''
  let fenceLen = 0
  const stripComments = createCommentStripper()
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = fenceChar === '' ? stripComments(raw) : raw
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceChar === '') {
      if (fence) {
        fenceChar = fence[1]![0]!
        fenceLen = fence[1]!.length
        continue
      }
      const match = HEADING_RE.exec(line)
      if (match) {
        current = match[1]!.toLowerCase()
        if (!sections.has(current)) sections.set(current, [])
        continue
      }
    } else if (
      fence &&
      fence[1]![0] === fenceChar &&
      fence[1]!.length >= fenceLen &&
      line.trim() === fence[1]!
    ) {
      fenceChar = ''
      fenceLen = 0
      continue
    }
    if (current !== undefined) {
      sections.get(current)!.push(line)
    }
  }
  const result = new Map<string, string>()
  for (const [key, lines] of sections) {
    result.set(key, lines.join('\n').trim())
  }
  return result
}

/** Returns the first same-repository issue number closed by `body`, or undefined if none. */
export function extractClosingIssue(body: string, repository: string): number | undefined {
  const stripped = stripCodeFences(body)
  const lowerRepo = repository.toLowerCase()
  for (const match of stripped.matchAll(CLOSING_ISSUE_RE)) {
    const refRepo = match[1]
    if (refRepo === undefined || refRepo.toLowerCase() === lowerRepo) {
      return Number(match[2]!)
    }
  }
  return undefined
}

export function validatePr(input: {
  title: string
  body: string
  provenanceComment: string
  extraFields: readonly string[]
}): PrValidationResult {
  const errors: ValidationError[] = []
  const trimmedTitle = input.title.trim()

  if (trimmedTitle === '' || /[\r\n]/.test(input.title)) {
    errors.push({
      rule: 'title-required',
      message: 'Pull request title must be a non-empty single line.',
    })
  } else {
    if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      errors.push({
        rule: 'title-length',
        message: `Pull request title must be at most ${MAX_TITLE_LENGTH} characters (got ${trimmedTitle.length}).`,
      })
    }
    if (BARE_ISSUE_RE.test(trimmedTitle)) {
      errors.push({
        rule: 'title-no-bare-issue',
        message: 'Pull request title must describe the change, not only reference an issue.',
      })
    }
  }

  const sections = parseSections(input.body)
  for (const { heading, rule } of REQUIRED_SECTIONS) {
    const content = sections.get(heading)
    if (content === undefined || content === '') {
      const label = heading[0]!.toUpperCase() + heading.slice(1)
      errors.push({
        rule,
        message: `Description must include a non-empty \`## ${label}\` section.`,
      })
    }
  }

  if (
    containsCredential(input.title) ||
    containsCredential(input.body) ||
    containsCredential(input.provenanceComment)
  ) {
    errors.push({
      rule: 'no-credentials',
      message: 'Title, description, and provenance comment must not contain credentials or tokens.',
    })
  }

  const provenance = validateProvenanceComment(input.provenanceComment, input.extraFields)
  errors.push(...provenance.errors)

  const provenanceFields = [...CORE_PROVENANCE_FIELDS, ...input.extraFields]
  const valid = errors.length === 0
  return {
    valid,
    errors,
    provenanceFields,
    ...(valid ? { provenanceComment: input.provenanceComment } : {}),
  }
}
