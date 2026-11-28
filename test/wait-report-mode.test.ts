import { afterEach, describe, expect, it } from 'vitest'
import { inReportMode } from '../src/config/repos.js'
import type { LoadedConfig } from '../src/config/load.js'
import type { Scope } from '../src/config/types.js'
import { cleanupLoops, makeLoop } from './helpers/loop.js'
import { lines, makeWorld, mergeEvent } from './helpers/wait.js'

const WAIT = ['wait']
const REPORT = {
  scopes: [{ owner: 'example-org', kind: 'org', repos: '*', mode: 'report' }],
}
const OLD = '2026-01-01T00:00:00Z'

function loaded(scopes: Array<Partial<Scope>>): LoadedConfig {
  return { config: { scopes } } as unknown as LoadedConfig
}

describe('supervisor wait: report-mode scopes', () => {
  afterEach(cleanupLoops)

  it('adds no pending update check for a dependency-bot merge in a report-mode scope', async () => {
    const loop = await makeLoop(REPORT)
    const events = [mergeEvent('m1', 'example-repo', 4, 'dependabot[bot]')]
    const world = makeWorld({ replies: [{ events }, { events: [], timedOut: true }] })
    const [summary] = lines((await loop.cli(WAIT, world.run, undefined, world.io)).stdout)
    expect(summary).toMatchObject({ quiet: { merges: ['example-org/example-repo#4'] } })
    expect(summary).not.toHaveProperty('pendingUpdateChecks')
    expect((await loop.state()).pendingUpdateChecks).toEqual([])
  })

  it('does not return updateCheckDue for a stored entry of a report-mode repository', async () => {
    const loop = await makeLoop(REPORT)
    await loop.seed({ pendingUpdateChecks: [{ repo: 'example-org/example-repo', at: OLD }] })
    const world = makeWorld({ replies: [{ events: [], timedOut: true }] })
    const [summary] = lines((await loop.cli(WAIT, world.run, undefined, world.io)).stdout)
    expect(summary).toEqual({ gap: false, timedOut: true, events: 0 })
  })

  it('still returns updateCheckDue for a stored entry in an enforce-mode scope', async () => {
    const loop = await makeLoop({
      scopes: [{ owner: 'example-org', kind: 'org', repos: '*', mode: 'enforce' }],
    })
    await loop.seed({ pendingUpdateChecks: [{ repo: 'example-org/example-repo', at: OLD }] })
    const world = makeWorld({ replies: [] })
    const [summary] = lines((await loop.cli(WAIT, world.run, undefined, world.io)).stdout)
    expect(summary).toMatchObject({
      pendingUpdateChecks: ['example-org/example-repo'],
      updateCheckDue: true,
    })
  })
})

describe('inReportMode', () => {
  const org = { owner: 'Example-Org', kind: 'org' as const }

  it('is true only when every covering scope reports', () => {
    const both = loaded([
      { ...org, repos: '*', mode: 'report' },
      { ...org, repos: ['a'], mode: 'enforce' },
    ])
    expect(inReportMode(both, 'example-org/a')).toBe(false)
    expect(inReportMode(both, 'example-org/b')).toBe(true)
  })

  it('treats a missing mode, an unnamed repository, and another owner as enforced', () => {
    const config = loaded([
      { ...org, repos: ['a'] },
      { ...org, repos: '*', excludedRepos: ['c'], mode: 'report' },
    ])
    expect(inReportMode(config, 'example-org/a')).toBe(false)
    expect(inReportMode(config, 'example-org/c')).toBe(false)
    expect(inReportMode(config, 'other-org/b')).toBe(false)
  })
})
