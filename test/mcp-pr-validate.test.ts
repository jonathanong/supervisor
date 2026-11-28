import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  callMcpTool,
  VALID_BODY,
  VALID_COMMENT,
  VALID_PROVENANCE,
  VALID_TITLE,
  writePrConfig,
} from './helpers/pr.js'

const REPO = 'example-org/example-repo'

let temp: string
let configPath: string

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'supervisor-mcp-pr-validate-'))
  configPath = await writePrConfig(temp, 'config.json')
})

afterAll(async () => {
  await rm(temp, { recursive: true, force: true })
})

describe('MCP pr_validate behavior', () => {
  it('validates structured provenance, code-fenced bodies, missing fields, and CRLF', async () => {
    const env = { SUPERVISOR_CONFIG: configPath }

    const structured = await callMcpTool(
      'pr_validate',
      { repository: REPO, title: VALID_TITLE, body: VALID_BODY, provenance: VALID_PROVENANCE },
      { env },
    )
    expect(structured.isError).toBeFalsy()
    expect(structured.structuredContent).toEqual({
      valid: true,
      errors: [],
      provenanceFields: ['harness', 'version', 'models', 'session', 'role', 'machine'],
      provenanceComment: VALID_COMMENT,
    })

    const fencedBody = [
      '~~~md',
      '## Problem',
      'Not a real section.',
      '~~~',
      '',
      '## Problem',
      '<!-- comment only -->',
      '',
      '## Change',
      'First part.',
      '## Change',
      'Second part.',
      '',
      '## Verification',
      '```sh',
      'pnpm test',
      '```',
    ].join('\r\n')

    const fenced = await callMcpTool(
      'pr_validate',
      {
        repository: REPO,
        title: 'Line1\nLine2',
        body: fencedBody,
        provenanceComment: `${VALID_COMMENT.replace(/\n/g, '\r\n')}\r\n- harness: dup\r\n- extra: bad`,
      },
      { env },
    )
    const data = fenced.structuredContent as { valid: boolean; errors: Array<{ rule: string }> }
    expect(data.valid).toBe(false)
    expect(data.errors.map((e) => e.rule)).toEqual([
      'title-required',
      'section-problem',
      'provenance-format',
      'provenance-scope-fields',
    ])

    const bare = await callMcpTool(
      'pr_validate',
      {
        repository: REPO,
        title: VALID_TITLE,
        body: VALID_BODY,
        provenanceComment: '<!-- supervisor:provenance v1 -->\n- machine:',
      },
      { env },
    )
    const bareData = bare.structuredContent as { valid: boolean; errors: Array<{ rule: string }> }
    expect(bareData.valid).toBe(false)
    expect(bareData.errors.map((e) => e.rule)).toEqual([
      'provenance-harness',
      'provenance-version',
      'provenance-models',
      'provenance-session',
      'provenance-role',
      'provenance-scope-fields',
    ])

    const badStructured = await callMcpTool(
      'pr_validate',
      {
        repository: REPO,
        title: VALID_TITLE,
        body: VALID_BODY,
        provenance: { ...VALID_PROVENANCE, models: ['model-a', ''], fields: { unexpected: 'v' } },
      },
      { env },
    )
    const bsData = badStructured.structuredContent as {
      valid: boolean
      errors: Array<{ rule: string; message: string }>
    }
    expect(bsData.valid).toBe(false)
    expect(bsData.errors.map((e) => e.rule)).toEqual([
      'provenance-models',
      'provenance-scope-fields',
    ])
    expect(bsData.errors[1]!.message).toContain('missing required fields: machine')
    expect(bsData.errors[1]!.message).toContain('unconfigured fields: unexpected')
  })
})
