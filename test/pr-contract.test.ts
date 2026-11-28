import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VALIDATOR_RULE_IDS, type ValidatorRuleId } from '../src/pr/validate.js'
import { callMcpTool, VALID_BODY, VALID_COMMENT, VALID_TITLE, writePrConfig } from './helpers/pr.js'

const SKILL_PATH = fileURLToPath(new URL('../skills/supervisor-pr/SKILL.md', import.meta.url))
const SKILL_RULE_RE = /^- \*\*`([a-z0-9-]+)`\*\*:\s*(.+)$/gm

interface ContractFixture {
  rule: ValidatorRuleId
  title?: string
  body?: string
  provenanceComment?: string
}

let temp: string
let configPath: string

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'supervisor-pr-contract-'))
  configPath = await writePrConfig(temp, 'config.json')
})

afterAll(async () => {
  await rm(temp, { recursive: true, force: true })
})

describe('PR description skill and pr_validate contract', () => {
  it('matches every skill rule 1-to-1 with VALIDATOR_RULE_IDS', async () => {
    const markdown = await readFile(SKILL_PATH, 'utf8')
    const skillRules = new Map<string, string>()
    for (const match of markdown.matchAll(SKILL_RULE_RE)) {
      const id = match[1]!
      const sentence = match[2]!.trim()
      expect(skillRules.has(id), `duplicate skill rule ${id}`).toBe(false)
      expect(sentence.length, `empty sentence for ${id}`).toBeGreaterThan(0)
      skillRules.set(id, sentence)
    }
    expect([...skillRules.keys()].sort()).toEqual([...VALIDATOR_RULE_IDS].sort())
  })

  it('accepts the valid baseline and rejects a dedicated fixture for every rule', async () => {
    const env = { SUPERVISOR_CONFIG: configPath }
    const base = await callMcpTool(
      'pr_validate',
      {
        repository: 'example-org/example-repo',
        title: VALID_TITLE,
        body: VALID_BODY,
        provenanceComment: VALID_COMMENT,
      },
      { env },
    )
    expect(base.isError).toBeFalsy()
    expect(base.structuredContent).toEqual({
      valid: true,
      errors: [],
      provenanceFields: ['harness', 'version', 'models', 'session', 'role', 'machine'],
      provenanceComment: VALID_COMMENT,
    })

    const fixtures: ContractFixture[] = [
      { rule: 'title-required', title: '   ' },
      { rule: 'title-length', title: 'A'.repeat(73) },
      { rule: 'title-no-bare-issue', title: 'Fixes #17' },
      { rule: 'section-problem', body: '## Change\n\nDid X.\n\n## Verification\n\nTested X.' },
      { rule: 'section-change', body: '## Problem\n\nSaw X.\n\n## Verification\n\nTested X.' },
      { rule: 'section-verification', body: '## Problem\n\nSaw X.\n\n## Change\n\nDid X.' },
      {
        rule: 'no-credentials',
        body: `${VALID_BODY}\n\nDebug token: ghp_1234567890abcdefghijklmnop123456`,
      },
      {
        rule: 'provenance-marker',
        provenanceComment: VALID_COMMENT.replace('<!-- supervisor:provenance v1 -->', '<!-- x -->'),
      },
      { rule: 'provenance-format', provenanceComment: `${VALID_COMMENT}\nnot a bullet line` },
      {
        rule: 'provenance-harness',
        provenanceComment: VALID_COMMENT.replace('- harness: claude-code', '- harness: '),
      },
      {
        rule: 'provenance-version',
        provenanceComment: VALID_COMMENT.replace('- version: 2.1.0', '- version: '),
      },
      {
        rule: 'provenance-models',
        provenanceComment: VALID_COMMENT.replace('- models: claude-sonnet-4-6', '- models: '),
      },
      {
        rule: 'provenance-session',
        provenanceComment: VALID_COMMENT.replace('- session: session-123', '- session: '),
      },
      {
        rule: 'provenance-role',
        provenanceComment: VALID_COMMENT.replace('- role: author', '- role: admin'),
      },
      {
        rule: 'provenance-scope-fields',
        provenanceComment: VALID_COMMENT.replace('\n- machine: workstation-1', ''),
      },
    ]

    expect(new Set(fixtures.map((f) => f.rule))).toEqual(new Set(VALIDATOR_RULE_IDS))
    for (const item of fixtures) {
      const res = await callMcpTool(
        'pr_validate',
        {
          repository: 'example-org/example-repo',
          title: item.title ?? VALID_TITLE,
          body: item.body ?? VALID_BODY,
          provenanceComment: item.provenanceComment ?? VALID_COMMENT,
        },
        { env },
      )
      expect(res.isError, item.rule).toBeFalsy()
      const data = res.structuredContent as { valid: boolean; errors: Array<{ rule: string }> }
      expect(data.valid, item.rule).toBe(false)
      expect(
        data.errors.map((e) => e.rule),
        item.rule,
      ).toContain(item.rule)
    }
  })
})
