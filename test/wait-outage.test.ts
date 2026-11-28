import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop } from './helpers/loop.js'
import { makeWorld, mergeEvent } from './helpers/wait.js'

const SCOPES = [
  { owner: 'example-org', kind: 'org', repos: '*', mode: 'enforce' },
  { owner: 'example-team', kind: 'org', repos: '*', mode: 'report' },
]

describe('supervisor wait relay outage across rounds', () => {
  afterEach(cleanupLoops)

  it('counts one owner relay errors across wait rounds while another owner keeps returning events', async () => {
    const loop = await makeLoop({ scopes: SCOPES })
    let merges = 0
    const world = makeWorld({
      replies: (req) => {
        if (req.owner === 'example-team') return { status: 503 }
        merges += 1
        return { events: [mergeEvent(`m${merges}`, 'example-repo', merges)] }
      },
    })
    const result = await loop.cli(['wait'], world.run, undefined, world.io)
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(
      /^supervisor wait: hook-harness relay unreachable \(5 consecutive errors for example-team\)/,
    )
    // Each round returns on the other owner's clean merge, so the outage spans several rounds.
    expect(world.timeouts.length).toBeGreaterThan(1)
  })
})
