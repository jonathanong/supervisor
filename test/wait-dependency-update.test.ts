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

// The fields of a real Dependabot update run: `name` is the job title, not the workflow name.
const UPDATE_RUN = {
  event: 'dynamic',
  name: 'npm_and_yarn in /. for @vitest/mocker - Update #1735964079',
  path: 'dynamic/dependabot/dependabot-updates',
  actor: { login: 'dependabot[bot]' },
}

describe('supervisor wait: dependency-bot update job', () => {
  afterEach(cleanupLoops)

  it('marks a dynamic run under the dependabot path', async () => {
    const line = await waitLine(run(UPDATE_RUN))
    expect(line).toMatchObject({ event: 'workflow_run', conclusion: 'failure' })
    expect(line.dependencyUpdate).toBe(true)
  })

  it('does not mark an ordinary failure, even one the dependency bot triggered', async () => {
    const line = await waitLine(
      run({ ...UPDATE_RUN, event: 'push', path: '.github/workflows/ci.yml' }),
    )
    expect(line).toMatchObject({ event: 'workflow_run', conclusion: 'failure' })
    expect(line.dependencyUpdate).toBeUndefined()
  })

  it('does not mark CodeQL default setup, which is also dynamic', async () => {
    const codeql = run({
      event: 'dynamic',
      name: 'CodeQL',
      path: 'dynamic/github-code-scanning/codeql',
      actor: { login: 'github[bot]' },
    })
    expect((await waitLine(codeql)).dependencyUpdate).toBeUndefined()
  })

  it('does not mark a dynamic run with no path', async () => {
    expect((await waitLine(run({ event: 'dynamic' }))).dependencyUpdate).toBeUndefined()
  })

  it('does not mark a run with no run payload', async () => {
    expect((await waitLine(envelope({}))).dependencyUpdate).toBeUndefined()
  })

  it('does not mark a different event', async () => {
    const other = envelope({
      event: 'pull_request',
      action: 'closed',
      payload: { workflow_run: UPDATE_RUN, pull_request: { merged: false } },
    })
    expect((await waitLine(other)).dependencyUpdate).toBeUndefined()
  })
})
