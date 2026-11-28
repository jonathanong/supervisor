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
  temp = await mkdtemp(join(tmpdir(), 'supervisor-mcp-pr-create-'))
  configPath = await writePrConfig(temp, 'config.json')
})

afterAll(async () => {
  await rm(temp, { recursive: true, force: true })
})

describe('MCP pr_create', () => {
  it('creates a PR, posts provenance, and inherits open milestone and open projects', async () => {
    const gh = createFakeGh((args) => {
      if (args.includes('graphql') && getFieldArg(args, 'query')?.includes('issue(number:')) {
        return okJson({
          data: {
            repository: {
              issue: {
                milestone: { number: 3, state: 'OPEN', title: 'Loop 4' },
                projectItems: {
                  nodes: [
                    null,
                    { project: { id: 'PVT_open', title: 'Roadmap', closed: false } },
                    { project: { id: 'PVT_open', title: 'Roadmap', closed: false } },
                    { project: { id: 'PVT_closed', title: 'Archive', closed: true } },
                  ],
                },
              },
            },
          },
        })
      }
      if (
        args.includes('graphql') &&
        getFieldArg(args, 'query')?.includes('addProjectV2ItemById')
      ) {
        return okJson({ data: { addProjectV2ItemById: { item: { id: 'PVTI_1' } } } })
      }
      if (args.includes(`repos/${REPO}`) && args.includes('.default_branch')) return okJson('main')
      if (args.includes(`repos/${REPO}/pulls`)) {
        return okJson({ number: 42, url: `https://github.com/${REPO}/pull/42`, nodeId: 'PR_42' })
      }
      if (args.includes(`repos/${REPO}/issues/42/comments`)) {
        return okJson({ id: 700, url: `https://github.com/${REPO}/pull/42#issuecomment-700` })
      }
      return okJson({ milestone: 3 })
    })

    const body = `${VALID_BODY}\n\n\`\`\`\nFixes #999\n\`\`\`\n\nCloses other-org/other-repo#88\nFixes #17`
    const res = await callMcpTool(
      'pr_create',
      {
        repository: REPO,
        head: 'pr-tools',
        draft: true,
        title: VALID_TITLE,
        body,
        provenance: VALID_PROVENANCE,
      },
      { env: { SUPERVISOR_CONFIG: configPath }, runProcess: gh.run },
    )

    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toEqual({
      repository: REPO,
      pr: 42,
      url: `https://github.com/${REPO}/pull/42`,
      provenanceCommentId: 700,
      provenanceCommentUrl: `https://github.com/${REPO}/pull/42#issuecomment-700`,
      provenanceComment: VALID_COMMENT,
      redacted: false,
      inherited: {
        issue: 17,
        milestone: { number: 3, title: 'Loop 4' },
        projects: [{ id: 'PVT_open', title: 'Roadmap' }],
      },
    })
    const createCall = gh.calls.find((c) => c.args.includes(`repos/${REPO}/pulls`))
    expect(getFieldArg(createCall!.args, 'base')).toBe('main')
    expect(getFieldArg(createCall!.args, 'draft')).toBe('true')
    const projectAdds = gh.calls.filter((c) =>
      getFieldArg(c.args, 'query')?.includes('addProjectV2ItemById'),
    )
    expect(projectAdds).toHaveLength(1)
    expect(getFieldArg(projectAdds[0]!.args, 'projectId')).toBe('PVT_open')
    expect(getFieldArg(projectAdds[0]!.args, 'contentId')).toBe('PR_42')
  })

  it('strips credentials from title, body, and provenance before calling gh', async () => {
    const secretA = 'ghp_1234567890abcdefghijklmnop123456'
    const secretB = 'sk-ant-api03-1234567890abcdefghijklmnop'
    const secretC = 'npm_1234567890abcdefghijklmnop'
    const gh = createFakeGh((args) => {
      if (args.includes('graphql')) {
        return okJson({
          data: {
            repository: {
              issue: {
                milestone: { number: 1, state: 'CLOSED', title: 'Old' },
                projectItems: null,
              },
            },
          },
        })
      }
      if (args.includes(`repos/${REPO}/pulls`)) {
        return okJson({ number: 9, url: `https://github.com/${REPO}/pull/9`, nodeId: 'PR_9' })
      }
      return okJson({ id: 90, url: `https://github.com/${REPO}/pull/9#issuecomment-90` })
    })

    const res = await callMcpTool(
      'pr_create',
      {
        repository: REPO,
        head: 'fix-branch',
        base: 'main',
        issue: 12,
        title: `Strip ${secretA} in titles`,
        body: `${VALID_BODY}\n\nLeak: ${secretB}`,
        provenance: { ...VALID_PROVENANCE, session: `sess-${secretC}` },
      },
      { env: { SUPERVISOR_CONFIG: configPath }, runProcess: gh.run },
    )

    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({
      redacted: true,
      inherited: { issue: 12, milestone: null, projects: [] },
    })
    const serialized = JSON.stringify(gh.calls)
    expect(serialized).not.toContain(secretA)
    expect(serialized).not.toContain(secretB)
    expect(serialized).not.toContain(secretC)
    expect(serialized).toContain('[REDACTED]')
  })

  it('refuses config-override args, invalid args, and validation failures without calling gh', async () => {
    const gh = createFakeGh(() => {
      throw new Error('should not call gh')
    })
    const env = { SUPERVISOR_CONFIG: configPath }
    const base = {
      repository: REPO,
      head: 'b',
      title: VALID_TITLE,
      body: VALID_BODY,
      provenance: VALID_PROVENANCE,
    }
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...base, provenanceFields: ['custom'] }, 'Unknown argument: provenanceFields.'],
      [{ ...base, head: '' }, 'head must be a non-empty string.'],
      [{ ...base, base: ' ' }, 'base must be a non-empty string.'],
      [{ ...base, title: 123 }, 'title must be a string.'],
      [{ ...base, body: 123 }, 'body must be a string.'],
      [{ ...base, draft: 'yes' }, 'draft must be a boolean.'],
      [{ ...base, issue: 0 }, 'must be a positive integer for issue.'],
      [{ ...base, title: 'Fixes #17' }, 'PR validation failed:'],
    ]

    for (const [args, expected] of cases) {
      const res = await callMcpTool('pr_create', args, { env, runProcess: gh.run })
      expect(res.isError, expected).toBe(true)
      expect(textContent(res), expected).toContain(expected)
    }
    expect(gh.calls).toEqual([])
  })
})
