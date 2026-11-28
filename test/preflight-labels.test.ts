import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, done, makeLoop } from './helpers/loop.js'
import { fake, GOOD } from './helpers/preflight.js'

const REPORT_SCOPES = [
  { owner: 'example-org', kind: 'org', repos: '*', mode: 'report' },
  { owner: 'example-user', kind: 'user', repos: ['demo-repo'], mode: 'report' },
]

describe('supervisor preflight labels check', () => {
  afterEach(cleanupLoops)

  it('skips checking labels with no gh api calls when all scopes are in report mode', async () => {
    const loop = await makeLoop({ scopes: REPORT_SCOPES })
    const { run, seen } = fake(GOOD)
    const result = await loop.cli(['preflight'], run)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('ok   labels: skipped: no scopes in enforce mode\n')
    expect(seen).toEqual(['supervisor --version', 'gh auth status', 'pr-shepherd --version'])
  })

  it('checks a report-mode scope as enforce when named with --enforce-scope', async () => {
    const loop = await makeLoop({ scopes: REPORT_SCOPES })
    const { run, seen } = fake({
      ...GOOD,
      ghUser: done('example-user\n'),
      ghRepos: done('demo-repo\tfalse\nother-repo\tfalse\n'),
      ghGraphql: done(
        JSON.stringify({
          data: {
            r0: { automation: { name: 'automation' }, needsHuman: null },
          },
        }),
      ),
    })
    const result = await loop.cli(['preflight', '--enforce-scope', 'Example-User', '--json'], run)
    expect(result.code).toBe(1)
    const labels = JSON.parse(result.stdout).checks.find(
      (check: { name: string }) => check.name === 'labels',
    )
    expect(labels).toEqual({
      name: 'labels',
      ok: false,
      detail: 'missing: example-user/demo-repo (needs-human)',
    })
    expect(seen.some((cmd) => cmd.includes('gh api user --jq .login'))).toBe(true)
    expect(seen.some((cmd) => cmd.includes('user/repos?affiliation=owner&per_page=100'))).toBe(true)
  })

  it('reuses signed-in login across user scopes and groups multiple scopes per owner', async () => {
    const loop = await makeLoop({
      scopes: [
        { owner: 'example-user', kind: 'user', repos: ['repo-a'], mode: 'enforce' },
        { owner: 'example-user', kind: 'user', repos: ['repo-b'], mode: 'enforce' },
        { owner: 'other-user', kind: 'user', repos: ['repo-c'], mode: 'enforce' },
      ],
    })
    let userCalls = 0
    const { run, seen } = fake({
      ...GOOD,
      ghUser: () => {
        userCalls += 1
        return done('example-user\n')
      },
      ghRepos: (args) => {
        if (args[2]!.startsWith('user/repos')) {
          return done('repo-a\tfalse\nrepo-b\tfalse\n')
        }
        return done('repo-c\tfalse\n')
      },
      ghGraphql: done(
        JSON.stringify({
          data: {
            r0: { automation: { name: 'automation' }, needsHuman: { name: 'needs-human' } },
            r1: { automation: { name: 'automation' }, needsHuman: { name: 'needs-human' } },
            r2: { automation: { name: 'automation' }, needsHuman: { name: 'needs-human' } },
          },
        }),
      ),
    })
    const result = await loop.cli(['preflight'], run)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('ok   labels: 3 repos checked (automation, needs-human)\n')
    expect(userCalls).toBe(1)
    expect(seen.some((cmd) => cmd.includes('users/other-user/repos?per_page=100'))).toBe(true)
  })

  it('reports ok when enforced scopes select no repositories', async () => {
    const loop = await makeLoop()
    const { run } = fake({ ...GOOD, ghRepos: done('') })
    const result = await loop.cli(['preflight'], run)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('ok   labels: no repositories matched\n')
  })

  it('reports missing automation, missing needsHuman, or both (deduplicated when identical)', async () => {
    const loop = await makeLoop()
    const missingBoth = await loop.cli(
      ['preflight'],
      fake({
        ...GOOD,
        ghRepos: done('repo-a\tfalse\nrepo-b\tfalse\n'),
        ghGraphql: done(
          JSON.stringify({
            data: {
              r0: { automation: null, needsHuman: null },
              r1: { automation: null, needsHuman: { name: 'needs-human' } },
            },
          }),
        ),
      }).run,
    )
    expect(missingBoth.code).toBe(1)
    expect(missingBoth.stdout).toContain(
      'FAIL labels: missing: example-org/repo-a (automation, needs-human); example-org/repo-b (automation)\n',
    )

    const sameLabel = await makeLoop({ labels: { automation: 'ops', needsHuman: 'ops' } })
    const deduped = await sameLabel.cli(
      ['preflight'],
      fake({
        ...GOOD,
        ghRepos: done('repo-a\tfalse\n'),
        ghGraphql: done(JSON.stringify({ data: { r0: { automation: null, needsHuman: null } } })),
      }).run,
    )
    expect(deduped.code).toBe(1)
    expect(deduped.stdout).toContain('FAIL labels: missing: example-org/repo-a (ops)\n')
  })

  it('batches GraphQL label checks across more than 25 repositories', async () => {
    const loop = await makeLoop()
    const repoLines = Array.from(
      { length: 27 },
      (_, i) => `repo-${String(i).padStart(2, '0')}\tfalse`,
    )
    let graphqlCalls = 0
    const { run } = fake({
      ...GOOD,
      ghRepos: done(`${repoLines.join('\n')}\n`),
      ghGraphql: (args) => {
        graphqlCalls += 1
        const query = args.find((arg) => arg.startsWith('query='))!
        const matches = [...query.matchAll(/\br(\d+):repository/g)]
        const data: Record<string, unknown> = {}
        for (const match of matches) {
          data[`r${match[1]}`] = {
            automation: { name: 'automation' },
            needsHuman: { name: 'needs-human' },
          }
        }
        return done(JSON.stringify({ data, errors: [] }))
      },
    })
    const result = await loop.cli(['preflight'], run)
    expect(result.code).toBe(0)
    expect(graphqlCalls).toBe(2)
    expect(result.stdout).toContain('ok   labels: 27 repos checked (automation, needs-human)\n')
  })
})
