import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { textContent } from './helpers/mcp.js'
import {
  callMcpTool,
  createFakeGh,
  getFieldArg,
  okJson,
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
  temp = await mkdtemp(join(tmpdir(), 'supervisor-mcp-pr-update-'))
  configPath = await writePrConfig(temp, 'config.json')
})

afterAll(async () => {
  await rm(temp, { recursive: true, force: true })
})

describe('MCP pr_update', () => {
  it('updates PR body, patches existing provenance comment in place, and inherits taxonomy', async () => {
    const gh = createFakeGh((args) => {
      if (args.includes('graphql') && getFieldArg(args, 'query')?.includes('issue(number:')) {
        return okJson({
          data: {
            repository: {
              issue: {
                milestone: { number: 2, state: 'OPEN', title: 'M2' },
                projectItems: {
                  nodes: [{ project: { id: 'PVT_2', title: 'Board', closed: false } }],
                },
              },
            },
          },
        })
      }
      if (args.includes('graphql')) {
        return okJson({ data: { addProjectV2ItemById: { item: { id: 'PVTI_2' } } } })
      }
      if (args.includes(`repos/${REPO}/pulls/11`)) {
        return okJson({ number: 11, url: `https://github.com/${REPO}/pull/11`, nodeId: 'PR_11' })
      }
      if (args.includes('--paginate') && args.includes(`repos/${REPO}/issues/11/comments`)) {
        return {
          code: 0,
          stdout: `${JSON.stringify({ id: 101, body: 'regular comment' })}\n${JSON.stringify({ id: 102, body: VALID_COMMENT })}\n`,
          stderr: '',
        }
      }
      if (args.includes(`repos/${REPO}/issues/comments/102`)) {
        return okJson({ id: 102, url: `https://github.com/${REPO}/pull/11#issuecomment-102` })
      }
      return okJson({ milestone: 2 })
    })

    const res = await callMcpTool(
      'pr_update',
      {
        repository: REPO,
        pr: 11,
        title: VALID_TITLE,
        body: `${VALID_BODY}\n\nResolves example-org/example-repo#17`,
        provenance: VALID_PROVENANCE,
      },
      { env: { SUPERVISOR_CONFIG: configPath }, runProcess: gh.run },
    )

    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toEqual({
      repository: REPO,
      pr: 11,
      url: `https://github.com/${REPO}/pull/11`,
      provenanceCommentId: 102,
      provenanceCommentUrl: `https://github.com/${REPO}/pull/11#issuecomment-102`,
      provenanceComment: VALID_COMMENT,
      redacted: false,
      inherited: {
        issue: 17,
        milestone: { number: 2, title: 'M2' },
        projects: [{ id: 'PVT_2', title: 'Board' }],
      },
    })
  })

  it('reads existing PR when title/body omitted and creates provenance comment if none exists', async () => {
    const gh = createFakeGh((args) => {
      if (args.includes(`repos/${REPO}/pulls/15`) && !args.includes('PATCH')) {
        return okJson({
          number: 15,
          url: `https://github.com/${REPO}/pull/15`,
          nodeId: 'PR_15',
          title: VALID_TITLE,
          body: VALID_BODY,
        })
      }
      if (args.includes(`repos/${REPO}/pulls/15`) && args.includes('PATCH')) {
        return okJson({ number: 15, url: `https://github.com/${REPO}/pull/15`, nodeId: 'PR_15' })
      }
      if (args.includes('--paginate')) return { code: 0, stdout: '', stderr: '' }
      return okJson({ id: 205, url: `https://github.com/${REPO}/pull/15#issuecomment-205` })
    })

    const res = await callMcpTool(
      'pr_update',
      { repository: REPO, pr: 15, provenance: VALID_PROVENANCE },
      { env: { SUPERVISOR_CONFIG: configPath }, runProcess: gh.run },
    )
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({
      pr: 15,
      provenanceCommentId: 205,
      inherited: { issue: null, milestone: null, projects: [] },
    })
  })

  it('rejects bad update arguments without calling gh', async () => {
    const env = { SUPERVISOR_CONFIG: configPath }
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ repository: REPO, pr: '1', provenance: VALID_PROVENANCE }, 'pr must be an integer.'],
      [
        { repository: REPO, pr: 1, title: 9, provenance: VALID_PROVENANCE },
        'title must be a string.',
      ],
      [
        { repository: REPO, pr: 1, body: 9, provenance: VALID_PROVENANCE },
        'body must be a string.',
      ],
      [
        { repository: REPO, pr: 1, issue: -1, provenance: VALID_PROVENANCE },
        'must be a positive integer for issue.',
      ],
    ]
    for (const [args, message] of cases) {
      const res = await callMcpTool('pr_update', args, { env })
      expect(res.isError, message).toBe(true)
      expect(textContent(res)).toContain(message)
    }
  })
})
