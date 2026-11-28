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
  temp = await mkdtemp(join(tmpdir(), 'supervisor-pr-gh-errors-'))
  configPath = await writePrConfig(temp, 'config.json')
})

afterAll(async () => {
  await rm(temp, { recursive: true, force: true })
})

describe('PR GitHub error and malformed payload handling', () => {
  it('redacts tokens in gh stderr and handles malformed pull, comment, and issue payloads', async () => {
    const env = { SUPERVISOR_CONFIG: configPath }
    const secret = 'ghp_1234567890abcdefghijklmnop123456'
    const ghError = createFakeGh(() => ({ code: 1, stdout: '', stderr: `auth failed ${secret}` }))
    const failed = await callMcpTool(
      'pr_update',
      {
        repository: REPO,
        pr: 1,
        title: VALID_TITLE,
        body: VALID_BODY,
        provenance: VALID_PROVENANCE,
      },
      { env, runProcess: ghError.run },
    )
    expect(failed.isError).toBe(true)
    expect(failed.structuredContent).toEqual({ code: 'gh-failed' })
    expect(textContent(failed)).toContain('[REDACTED]')
    expect(textContent(failed)).not.toContain(secret)

    const longError = createFakeGh(() => ({
      code: 1,
      stdout: '',
      stderr: `${'x'.repeat(190)} "password": "super secret value that is long"`,
    }))
    const truncated = await callMcpTool(
      'pr_update',
      {
        repository: REPO,
        pr: 1,
        title: VALID_TITLE,
        body: VALID_BODY,
        provenance: VALID_PROVENANCE,
      },
      { env, runProcess: longError.run },
    )
    expect(textContent(truncated)).not.toContain('super secret')
    expect(textContent(truncated)).not.toContain('"super')

    const readCases: Array<
      [string, () => { code: number; stdout: string; stderr: string }, string]
    > = [
      ['invalid JSON', () => ({ code: 0, stdout: '{bad', stderr: '' }), 'returned invalid JSON'],
      ['bad pull ref', () => okJson({ number: 'x' }), 'unexpected pull request payload'],
      [
        'bad pull details',
        () => okJson({ number: 1, url: 'u', nodeId: 'n', title: 5, body: '' }),
        'unexpected pull request payload',
      ],
    ]
    for (const [label, handler, message] of readCases) {
      const res = await callMcpTool(
        'pr_update',
        { repository: REPO, pr: 1, provenance: VALID_PROVENANCE },
        { env, runProcess: createFakeGh(handler).run },
      )
      expect(res.isError, label).toBe(true)
      expect(res.structuredContent, label).toEqual({ code: 'gh-invalid-response' })
      expect(textContent(res), label).toContain(message)
    }

    for (const [label, payload] of [
      ['empty graphql', {}],
      ['missing repository', { data: {} }],
      ['missing issue', { data: { repository: { issue: null } } }],
    ] as const) {
      const res = await callMcpTool(
        'pr_update',
        {
          repository: REPO,
          pr: 1,
          issue: 404,
          title: VALID_TITLE,
          body: VALID_BODY,
          provenance: VALID_PROVENANCE,
        },
        { env, runProcess: createFakeGh(() => okJson(payload)).run },
      )
      expect(res.isError, label).toBe(true)
      expect(res.structuredContent, label).toEqual({ code: 'not-found' })
      expect(textContent(res), label).toContain('Issue example-org/example-repo#404 was not found.')
    }

    const badBranch = await callMcpTool(
      'pr_create',
      {
        repository: REPO,
        head: 'h',
        title: VALID_TITLE,
        body: VALID_BODY,
        provenance: VALID_PROVENANCE,
      },
      { env, runProcess: createFakeGh(() => ({ code: 0, stdout: '\n', stderr: '' })).run },
    )
    expect(badBranch.isError).toBe(true)
    expect(badBranch.structuredContent).toEqual({ code: 'gh-invalid-response' })
    expect(textContent(badBranch)).toContain('no default branch')

    for (const [label, commentStdout, expected] of [
      ['non-object line', '"str"\n', 'returned a non-object item'],
      ['invalid line JSON', '{bad\n', 'returned invalid JSON'],
    ] as const) {
      const gh = createFakeGh((args) =>
        args.includes(`repos/${REPO}/pulls/1`)
          ? okJson({ number: 1, url: 'u', nodeId: 'n' })
          : { code: 0, stdout: commentStdout, stderr: '' },
      )
      const res = await callMcpTool(
        'pr_update',
        {
          repository: REPO,
          pr: 1,
          title: VALID_TITLE,
          body: VALID_BODY,
          provenance: VALID_PROVENANCE,
        },
        { env, runProcess: gh.run },
      )
      expect(res.isError, label).toBe(true)
      expect(res.structuredContent, label).toEqual({ code: 'gh-invalid-response' })
      expect(textContent(res), label).toContain(expected)
    }

    const badCommentRef = createFakeGh((args) => {
      if (args.includes(`repos/${REPO}/pulls/1`))
        return okJson({ number: 1, url: 'u', nodeId: 'n' })
      if (args.includes('--paginate')) return { code: 0, stdout: '', stderr: '' }
      return okJson({ bad: true })
    })
    const bcrRes = await callMcpTool(
      'pr_update',
      {
        repository: REPO,
        pr: 1,
        title: VALID_TITLE,
        body: VALID_BODY,
        provenance: VALID_PROVENANCE,
      },
      { env, runProcess: badCommentRef.run },
    )
    expect(bcrRes.isError).toBe(true)
    expect(textContent(bcrRes)).toContain('unexpected comment payload')
  })
})
