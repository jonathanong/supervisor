import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop } from './helpers/loop.js'
import { envelope, lines, makeWorld, ORG_ONLY } from './helpers/wait.js'

async function waitLine(event: Record<string, unknown>) {
  const loop = await makeLoop(ORG_ONLY)
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
    const line = await waitLine(run({ event: 'dynamic', name: 'Dependabot Updates' }))
    expect(line).toMatchObject({ event: 'workflow_run', conclusion: 'failure' })
    expect(line.dependencyUpdate).toBe(true)
  })

  it('does not mark an ordinary failure, even one the dependency bot triggered', async () => {
    const line = await waitLine(run({ event: 'push', actor: { login: 'dependabot[bot]' } }))
    expect(line).toMatchObject({ event: 'workflow_run', conclusion: 'failure' })
    expect(line.dependencyUpdate).toBeUndefined()
  })

  it('marks a run named only by the event workflow field', async () => {
    const event = envelope({
      workflow: 'Dependabot Updates',
      payload: { workflow_run: { event: 'dynamic' } },
    })
    expect((await waitLine(event)).dependencyUpdate).toBe(true)
  })

  it('does not mark another dynamic run such as CodeQL default setup', async () => {
    const line = await waitLine(run({ event: 'dynamic', name: 'CodeQL' }))
    expect(line.dependencyUpdate).toBeUndefined()
  })

  it('does not mark a dynamic run with no workflow name', async () => {
    const event = envelope({ workflow: null, payload: { workflow_run: { event: 'dynamic' } } })
    expect((await waitLine(event)).dependencyUpdate).toBeUndefined()
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
