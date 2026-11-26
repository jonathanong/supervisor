import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { check, fixture, HEAD, OLD_HEAD, REPO, policyDir } from './helpers/pull.js'

const DIR = ['--dir', policyDir('pull-facts')]
const layered = (name: string) =>
  fileURLToPath(new URL(`./fixtures/policies/layered/${name}`, import.meta.url))

describe('asking pr-shepherd whether the head can merge', () => {
  it('fails closed, exit 2 and no output, when pr-shepherd names another head', async () => {
    const result = await check(fixture({ shepherd: { action: 'merge', headSha: OLD_HEAD } }), DIR)
    expect(result.stderr).toBe(`${REPO}#7 got a new head while pr-shepherd read it\n`)
    expect(result.stdout).toBe('')
    expect(result.code).toBe(2)
  })

  it('compares the heads without regard to case', async () => {
    const shepherd = { action: 'merge', headSha: HEAD.toUpperCase() }
    const result = await check(fixture({ shepherd }), [...DIR, '--json'])
    expect(result.code).toBe(0)
  })

  it('fails closed when pr-shepherd throws, and never reports the head ready', async () => {
    const result = await check(fixture({ shepherd: new Error('GitHub is down') }), [
      ...DIR,
      '--print-input',
    ])
    expect(result.stderr).toBe(`pr-shepherd could not read ${REPO}#7: GitHub is down\n`)
    expect(result.stdout).toBe('')
    expect(result.code).toBe(2)
  })

  it('asks about the pull request from the current directory without --repo-dir', async () => {
    const result = await check(fixture(), DIR)
    expect(result.shepherdCalls).toEqual([[`${REPO}#7`, process.cwd()]])
  })

  it('asks from the --repo-dir checkout when it is given', async () => {
    const options = ['--dir', layered('supervisor'), '--repo-dir', layered('repo-plain')]
    const result = await check(fixture(), options)
    expect(result.shepherdCalls).toEqual([[`${REPO}#7`, layered('repo-plain')]])
  })
})
