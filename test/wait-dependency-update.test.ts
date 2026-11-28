import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop } from './helpers/loop.js'
import { envelope, lines, makeWorld, ORG_ONLY } from './helpers/wait.js'

async function waitLine(event: Record<string, unknown>, config = ORG_ONLY) {
  const loop = await makeLoop(config)
  const world = makeWorld({ replies: [{ events: [event], cursor: '1767323045001#1' }] })
  const result = await loop.cli(['wait'], world.run, undefined, { fetch: world.fetch })
  expect(result).toMatchObject({ code: 0, stderr: '' })
  return lines(result.stdout)[1]!
}

const run = (workflowRun: Record<string, unknown>) =>
  envelope({ payload: { workflow_run: workflowRun } })

describe('supervisor wait: dependency-bot update job', () => {
  afterEach(cleanupLoops)

  it('marks a run whose triggering event is dynamic', async () => {
    const line = await waitLine(run({ event: 'dynamic', actor: { login: 'someone' } }))
    expect(line).toMatchObject({ event: 'workflow_run', conclusion: 'failure' })
    expect(line.dependencyUpdate).toBe(true)
  })

  it('marks a run whose actor is the default dependency bot', async () => {
    const line = await waitLine(run({ event: 'push', actor: { login: 'dependabot[bot]' } }))
    expect(line.dependencyUpdate).toBe(true)
  })

  it('marks a run whose actor is the configured dependency bot', async () => {
    const config = { ...ORG_ONLY, dependencyBot: { author: 'renovate' } }
    const line = await waitLine(run({ event: 'push', actor: { login: 'renovate[bot]' } }), config)
    expect(line.dependencyUpdate).toBe(true)
  })

  it('does not mark an ordinary default-branch failure', async () => {
    const line = await waitLine(run({ event: 'push', actor: { login: 'example-user' } }))
    expect(line.dependencyUpdate).toBeUndefined()
  })

  it('does not mark a run with no actor', async () => {
    expect((await waitLine(run({ event: 'push' }))).dependencyUpdate).toBeUndefined()
  })

  it('does not mark a run with no run payload', async () => {
    expect((await waitLine(envelope({}))).dependencyUpdate).toBeUndefined()
  })

  it('does not mark a different event', async () => {
    const other = envelope({
      event: 'pull_request',
      action: 'closed',
      payload: { workflow_run: { event: 'dynamic' }, pull_request: { merged: false } },
    })
    expect((await waitLine(other)).dependencyUpdate).toBeUndefined()
  })
})
