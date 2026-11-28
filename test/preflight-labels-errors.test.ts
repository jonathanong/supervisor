import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, done, makeLoop } from './helpers/loop.js'
import { fake, GOOD } from './helpers/preflight.js'

const REPORT_SCOPES = [
  { owner: 'example-org', kind: 'org', repos: '*', mode: 'report' },
  { owner: 'example-user', kind: 'user', repos: ['demo-repo'], mode: 'report' },
]

describe('supervisor preflight labels check errors', () => {
  afterEach(cleanupLoops)

  it('fails on unknown --enforce-scope owners without calling gh api', async () => {
    const loop = await makeLoop({ scopes: REPORT_SCOPES })
    const { run, seen } = fake(GOOD)
    const result = await loop.cli(
      ['preflight', '--enforce-scope', 'ghost', '--enforce-scope', 'ghost'],
      run,
    )
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('FAIL labels: unknown --enforce-scope: ghost\n')
    expect(seen).toEqual(['supervisor --version', 'gh auth status', 'pr-shepherd --version'])
  })

  it('fails when labels.automation or labels.needsHuman is missing from config', async () => {
    const bothMissing = await makeLoop({ labels: undefined })
    expect((await bothMissing.cli(['preflight'], fake(GOOD).run)).stdout).toContain(
      'FAIL labels: missing config: labels.automation, labels.needsHuman\n',
    )
    const oneMissing = await makeLoop({ labels: { automation: 'automation' } })
    expect((await oneMissing.cli(['preflight'], fake(GOOD).run)).stdout).toContain(
      'FAIL labels: missing config: labels.needsHuman\n',
    )
  })

  it('skips calling gh api when the gh auth check failed', async () => {
    const loop = await makeLoop()
    const { run, seen } = fake({ ...GOOD, gh: done('', 1, 'not logged in') })
    const result = await loop.cli(['preflight'], run)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('FAIL labels: skipped: gh check failed\n')
    expect(seen).toEqual(['supervisor --version', 'gh auth status', 'pr-shepherd --version'])
  })

  it('reports gh and GraphQL errors cleanly on one line', async () => {
    const loop = await makeLoop()

    const stderrFail = await loop.cli(
      ['preflight'],
      fake({ ...GOOD, ghRepos: done('', 1, 'HTTP 403\nrate limit') }).run,
    )
    expect(stderrFail.code).toBe(1)
    expect(stderrFail.stdout).toContain('FAIL labels: gh exited 1: HTTP 403\n')

    const stdoutOnlyFail = await loop.cli(
      ['preflight'],
      fake({ ...GOOD, ghRepos: done('api failed\n', 1, '') }).run,
    )
    expect(stdoutOnlyFail.stdout).toContain('FAIL labels: gh exited 1: api failed\n')

    const thrown = await loop.cli(
      ['preflight'],
      fake({ ...GOOD, ghGraphql: new Error('timeout\nmore') }).run,
    )
    expect(thrown.stdout).toContain('FAIL labels: timeout\n')

    const badJson = await loop.cli(
      ['preflight'],
      fake({ ...GOOD, ghGraphql: done('not json') }).run,
    )
    expect(badJson.stdout).toContain('FAIL labels: gh api graphql printed invalid JSON\n')

    const nonObject = await loop.cli(['preflight'], fake({ ...GOOD, ghGraphql: done('null') }).run)
    expect(nonObject.stdout).toContain(
      'FAIL labels: gh api graphql returned an unexpected response\n',
    )

    const gqlMessage = await loop.cli(
      ['preflight'],
      fake({
        ...GOOD,
        ghGraphql: done(JSON.stringify({ errors: [{ message: 'API rate limit' }] })),
      }).run,
    )
    expect(gqlMessage.stdout).toContain('FAIL labels: API rate limit\n')

    const gqlNoMessage = await loop.cli(
      ['preflight'],
      fake({ ...GOOD, ghGraphql: done(JSON.stringify({ errors: [{}] })) }).run,
    )
    expect(gqlNoMessage.stdout).toContain('FAIL labels: GraphQL request returned errors\n')

    const noData = await loop.cli(
      ['preflight'],
      fake({ ...GOOD, ghGraphql: done(JSON.stringify({})) }).run,
    )
    expect(noData.stdout).toContain('FAIL labels: gh api graphql returned no data\n')

    const missingRepo = await loop.cli(
      ['preflight'],
      fake({ ...GOOD, ghGraphql: done(JSON.stringify({ data: { r0: null } })) }).run,
    )
    expect(missingRepo.stdout).toContain(
      'FAIL labels: repository example-org/example-repo not found in GraphQL response\n',
    )
  })
})
