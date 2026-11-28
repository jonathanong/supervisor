import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { textContent } from './helpers/mcp.js'
import {
  callMcpTool,
  createFakeGh,
  okJson,
  VALID_BODY,
  VALID_PROVENANCE,
  VALID_TITLE,
  writePrConfig,
} from './helpers/pr.js'

const REPO = 'example-org/example-repo'

let temp: string
let configPath: string

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'supervisor-mcp-pr-create-partial-'))
  configPath = await writePrConfig(temp, 'config.json')
})

afterAll(async () => {
  await rm(temp, { recursive: true, force: true })
})

describe('MCP pr_create partial failure', () => {
  it('returns the opened PR number and url when a step after opening fails', async () => {
    const gh = createFakeGh((args) => {
      if (args.includes('graphql')) {
        return okJson({
          data: {
            repository: {
              issue: {
                milestone: { number: 3, state: 'OPEN', title: 'Loop 4' },
                projectItems: null,
              },
            },
          },
        })
      }
      if (args.includes(`repos/${REPO}/pulls`)) {
        return okJson({ number: 42, url: `https://github.com/${REPO}/pull/42`, nodeId: 'PR_42' })
      }
      if (args.includes(`repos/${REPO}/issues/42/comments`)) {
        return okJson({ id: 700, url: `https://github.com/${REPO}/pull/42#issuecomment-700` })
      }
      return { code: 1, stdout: '', stderr: 'milestone failed' }
    })
    const res = await callMcpTool(
      'pr_create',
      {
        repository: REPO,
        head: 'pr-tools',
        base: 'main',
        issue: 17,
        title: VALID_TITLE,
        body: VALID_BODY,
        provenance: VALID_PROVENANCE,
      },
      { env: { SUPERVISOR_CONFIG: configPath }, runProcess: gh.run },
    )
    expect(res.isError).toBe(true)
    expect(res.structuredContent).toEqual({
      code: 'pr-partially-written',
      repository: REPO,
      pr: 42,
      url: `https://github.com/${REPO}/pull/42`,
    })
    expect(textContent(res)).toContain('#42')
    expect(textContent(res)).toContain(`https://github.com/${REPO}/pull/42`)
  })
})
