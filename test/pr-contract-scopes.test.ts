import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  callMcpTool,
  createFakeGh,
  getFieldArg,
  okJson,
  VALID_BODY,
  VALID_PROVENANCE,
  VALID_TITLE,
  writePrConfig,
} from './helpers/pr.js'

let temp: string
let configPath: string

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'supervisor-pr-contract-scopes-'))
  configPath = await writePrConfig(temp, 'config.json')
})

afterAll(async () => {
  await rm(temp, { recursive: true, force: true })
})

describe('PR provenance rendering and validation agreement across scopes', () => {
  it('agrees between pr_create rendering and pr_validate for every configured scope', async () => {
    const env = { SUPERVISOR_CONFIG: configPath }
    const { fields: _ignored, ...baseProv } = VALID_PROVENANCE
    const scopes: Array<{
      repo: string
      fields?: Record<string, string>
      expected: string[]
      wrongRepo: string
    }> = [
      {
        repo: 'example-org/example-repo',
        fields: { machine: 'workstation-1' },
        expected: ['harness', 'version', 'models', 'session', 'role', 'machine'],
        wrongRepo: 'example-user/plain-repo',
      },
      {
        repo: 'example-org/excluded-repo',
        fields: { worktree: 'pr-tools' },
        expected: ['harness', 'version', 'models', 'session', 'role', 'worktree'],
        wrongRepo: 'example-org/example-repo',
      },
      {
        repo: 'example-user/plain-repo',
        expected: ['harness', 'version', 'models', 'session', 'role'],
        wrongRepo: 'example-org/example-repo',
      },
      {
        repo: 'other-org/fallback-repo',
        fields: { machine: 'workstation-2' },
        expected: ['harness', 'version', 'models', 'session', 'role', 'machine'],
        wrongRepo: 'example-user/plain-repo',
      },
    ]

    for (const item of scopes) {
      const gh = createFakeGh((args) =>
        args.includes(`repos/${item.repo}/pulls`)
          ? okJson({ number: 5, url: `https://github.com/${item.repo}/pull/5`, nodeId: 'PR_5' })
          : okJson({ id: 99, url: `https://github.com/${item.repo}/pull/5#issuecomment-99` }),
      )
      const provenance = item.fields !== undefined ? { ...baseProv, fields: item.fields } : baseProv
      const created = await callMcpTool(
        'pr_create',
        {
          repository: item.repo,
          head: 'f',
          base: 'main',
          title: VALID_TITLE,
          body: VALID_BODY,
          provenance,
        },
        { env, runProcess: gh.run },
      )
      expect(created.isError, item.repo).toBeFalsy()
      const commentCall = gh.calls.find((c) =>
        c.args.includes(`repos/${item.repo}/issues/5/comments`),
      )
      const rendered = getFieldArg(commentCall!.args, 'body')!

      const valid = await callMcpTool(
        'pr_validate',
        {
          repository: item.repo,
          title: VALID_TITLE,
          body: VALID_BODY,
          provenanceComment: rendered,
        },
        { env },
      )
      expect(valid.structuredContent, item.repo).toEqual({
        valid: true,
        errors: [],
        provenanceFields: item.expected,
        provenanceComment: rendered,
      })

      const mismatch = await callMcpTool(
        'pr_validate',
        {
          repository: item.wrongRepo,
          title: VALID_TITLE,
          body: VALID_BODY,
          provenanceComment: rendered,
        },
        { env },
      )
      const data = mismatch.structuredContent as { valid: boolean; errors: Array<{ rule: string }> }
      expect(data.valid, item.repo).toBe(false)
      expect(data.errors.map((e) => e.rule)).toContain('provenance-scope-fields')
    }
  })
})
