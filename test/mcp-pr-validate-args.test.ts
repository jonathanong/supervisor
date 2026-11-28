import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { textContent } from './helpers/mcp.js'
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
  temp = await mkdtemp(join(tmpdir(), 'supervisor-mcp-pr-val-args-'))
  configPath = await writePrConfig(temp, 'config.json')
})

afterAll(async () => {
  await rm(temp, { recursive: true, force: true })
})

describe('MCP pr_validate argument and config errors', () => {
  it('rejects malformed arguments and invalid config provenance field names', async () => {
    const env = { SUPERVISOR_CONFIG: configPath }
    const base = { repository: REPO, title: VALID_TITLE, body: VALID_BODY }
    const cases: Array<[Record<string, unknown>, string]> = [
      [
        { ...base, repository: 'bad-repo', provenanceComment: VALID_COMMENT },
        'must look like <owner>/<repo>.',
      ],
      [{ ...base, title: 1, provenanceComment: VALID_COMMENT }, 'title must be a string.'],
      [{ ...base, body: 1, provenanceComment: VALID_COMMENT }, 'body must be a string.'],
      [base, 'Provide exactly one of provenance or provenanceComment.'],
      [
        { ...base, provenance: VALID_PROVENANCE, provenanceComment: VALID_COMMENT },
        'Provide exactly one of provenance or provenanceComment.',
      ],
      [{ ...base, provenanceComment: 123 }, 'provenanceComment must be a string.'],
      [{ ...base, provenance: 'bad' }, 'provenance must be an object.'],
      [
        { ...base, provenance: { ...VALID_PROVENANCE, extra: 1 } },
        'Unknown provenance argument: extra.',
      ],
      [
        { ...base, provenance: { ...VALID_PROVENANCE, harness: 1 } },
        'provenance.harness must be a string.',
      ],
      [
        { ...base, provenance: { ...VALID_PROVENANCE, version: 1 } },
        'provenance.version must be a string.',
      ],
      [
        { ...base, provenance: { ...VALID_PROVENANCE, models: 'm' } },
        'provenance.models must be an array of single-line strings.',
      ],
      [
        { ...base, provenance: { ...VALID_PROVENANCE, harness: 'claude\n- machine: spoof' } },
        'provenance.harness must be a single line.',
      ],
      [
        { ...base, provenance: { ...VALID_PROVENANCE, fields: { 'bad\nkey': 'v' } } },
        'provenance.fields keys must be single-line.',
      ],
      [
        { ...base, provenance: { ...VALID_PROVENANCE, session: 1 } },
        'provenance.session must be a string.',
      ],
      [
        { ...base, provenance: { ...VALID_PROVENANCE, role: 1 } },
        'provenance.role must be a string.',
      ],
      [
        { ...base, provenance: { ...VALID_PROVENANCE, fields: [] } },
        'provenance.fields must be an object.',
      ],
      [
        { ...base, provenance: { ...VALID_PROVENANCE, fields: { machine: 1 } } },
        'provenance.fields.machine must be a string.',
      ],
      [
        { ...base, provenanceComment: VALID_COMMENT, provenanceFields: ['x'] },
        'Unknown argument: provenanceFields.',
      ],
    ]

    for (const [args, message] of cases) {
      const res = await callMcpTool('pr_validate', args, { env })
      expect(res.isError, message).toBe(true)
      expect(textContent(res), message).toContain(message)
    }

    const badConfig = await writePrConfig(temp, 'bad-field.json', {
      provenance: { fields: ['bad field!'] },
      scopes: [],
    })
    const cfgErr = await callMcpTool(
      'pr_validate',
      { ...base, provenanceComment: VALID_COMMENT },
      { env: { SUPERVISOR_CONFIG: badConfig } },
    )
    expect(cfgErr.isError).toBe(true)
    expect(textContent(cfgErr)).toContain("provenance field 'bad field!'")

    const dupConfig = await writePrConfig(temp, 'dup-field.json', {
      provenance: { fields: ['session', 'machine', 'machine'] },
      scopes: [],
    })
    const dupRes = await callMcpTool(
      'pr_validate',
      { ...base, provenanceComment: VALID_COMMENT },
      { env: { SUPERVISOR_CONFIG: dupConfig } },
    )
    expect(dupRes.isError).toBeFalsy()
    expect(dupRes.structuredContent).toMatchObject({
      valid: true,
      provenanceFields: ['harness', 'version', 'models', 'session', 'role', 'machine'],
    })
  })
})
