import { describe, expect, it } from 'vitest'
import {
  check,
  checkRun,
  fixture,
  OLD_HEAD,
  policyDir,
  statusContext,
  type GhFixture,
} from './helpers/pull.js'

const DIR = ['--dir', policyDir('pull-facts')]
const pass = (name: string, required = false) => checkRun(name, 'COMPLETED', 'SUCCESS', required)

async function checkJson(gh: GhFixture) {
  const result = await check(gh, [...DIR, '--json'])
  expect(result.stderr).toBe('')
  return { code: result.code, result: JSON.parse(result.stdout) }
}

describe('the checks GitHub requires for a pull request', () => {
  it('holds a merge only on the required checks and lists the others', async () => {
    const gh = fixture({
      contexts: [
        pass('test', true),
        checkRun('lint', 'COMPLETED', 'FAILURE'),
        statusContext('deploy', 'PENDING'),
        statusContext('coverage', 'SUCCESS', true),
      ],
    })
    const { code, result } = await checkJson(gh)
    expect(code).toBe(0)
    expect(result.nextStep).toEqual({ action: 'merge' })
    expect(result.checks).toEqual({
      source: 'required-checks',
      state: 'success',
      total: 4,
      failing: [],
      pending: [],
      notRequired: ['lint', 'deploy'],
      mergeState: 'CLEAN',
    })
    const human = await check(gh, DIR)
    expect(human.stdout).toContain('Checks: success (4 on the head; GitHub requires checks)\n')
    expect(human.stdout).toContain(
      'Not required, failing or pending, and do not hold the merge: lint, deploy\n',
    )
    expect(human.stdout).not.toContain('Failing checks')
  })

  it('holds the merge on a required check that fails or is pending', async () => {
    const failed = await checkJson(
      fixture({ contexts: [pass('test', true), checkRun('lint', 'COMPLETED', 'FAILURE', true)] }),
    )
    expect(failed.code).toBe(1)
    expect(failed.result.checks).toMatchObject({ state: 'failure', failing: ['lint'] })
    expect(failed.result.nextStep.reason).toBe('Checks failed on the head: lint')

    const waiting = await checkJson(
      fixture({ contexts: [pass('test', true), statusContext('deploy', 'PENDING', true)] }),
    )
    expect(waiting.code).toBe(1)
    expect(waiting.result.checks).toMatchObject({ state: 'pending', pending: ['deploy'] })
  })

  it('holds the merge on every check when none is required', async () => {
    const { code, result } = await checkJson(
      fixture({ contexts: [pass('test'), checkRun('lint', 'COMPLETED', 'FAILURE')] }),
    )
    expect(code).toBe(1)
    expect(result.checks).toMatchObject({
      source: 'all-checks-on-head',
      failing: ['lint'],
      notRequired: [],
    })
  })

  it('holds the merge when GitHub says BLOCKED, and only then', async () => {
    const contexts = [pass('test', true)]
    const blocked = await checkJson(fixture({ contexts, mergeState: 'BLOCKED' }))
    expect(blocked.code).toBe(1)
    expect(blocked.result.checks).toMatchObject({ state: 'success', mergeState: 'BLOCKED' })
    expect(blocked.result.blockers).toEqual([
      'GitHub blocks the merge: a required check has not reported, or a branch rule is not met',
    ])
    expect(blocked.result.policyNextStep).toEqual({ action: 'merge' })
    expect(blocked.result.nextStep.action).toBe('escalate')

    for (const restMergeState of ['unknown', undefined, '', 7]) {
      const unknown = await checkJson(fixture({ contexts, mergeState: 'UNKNOWN', restMergeState }))
      expect(unknown.code).toBe(1)
      expect(unknown.result.checks.mergeState).toBe('UNKNOWN')
      expect(unknown.result.blockers).toEqual(['GitHub has not worked out the merge state yet'])
      expect(unknown.result.nextStep.action).toBe('escalate')
    }

    for (const mergeState of ['CLEAN', 'UNSTABLE', 'BEHIND']) {
      const open = await checkJson(fixture({ contexts, mergeState }))
      expect(open.code).toBe(0)
      expect(open.result.blockers).toEqual([])
      expect(open.result.checks.mergeState).toBe(mergeState)
    }
  })

  it('reads an UNKNOWN merge state once more over REST', async () => {
    const contexts = [pass('test', true)]
    const clean = await checkJson(fixture({ contexts, mergeState: 'UNKNOWN' }))
    expect(clean.code).toBe(0)
    expect(clean.result.checks.mergeState).toBe('CLEAN')
    expect(clean.result.blockers).toEqual([])

    const blocked = await checkJson(
      fixture({ contexts, mergeState: 'UNKNOWN', restMergeState: 'blocked' }),
    )
    expect(blocked.code).toBe(1)
    expect(blocked.result.checks.mergeState).toBe('BLOCKED')
    expect(blocked.result.blockers).toEqual([
      'GitHub blocks the merge: a required check has not reported, or a branch rule is not met',
    ])
  })

  it('ignores the REST merge state when GraphQL already knows it', async () => {
    const contexts = [pass('test', true)]
    const { code, result } = await checkJson(
      fixture({ contexts, mergeState: 'CLEAN', restMergeState: 'blocked' }),
    )
    expect(code).toBe(0)
    expect(result.checks.mergeState).toBe('CLEAN')
    expect(result.blockers).toEqual([])
  })

  it('treats a head with no checks, or no check rollup, as none', async () => {
    for (const contexts of [[], null]) {
      const { code, result } = await checkJson(fixture({ contexts }))
      expect(code).toBe(1)
      expect(result.checks).toMatchObject({ state: 'none', total: 0, notRequired: [] })
    }
  })

  it('refuses a head that moved, more than 100 checks, and a check it cannot judge', async () => {
    const cases: Array<[Partial<GhFixture>, string]> = [
      [{ checksHead: OLD_HEAD }, 'got a new head while its checks were read'],
      [{ checksHead: null }, 'GitHub returned no head of the pull request'],
      [{ contexts: [checkRun('', 'COMPLETED', 'SUCCESS')] }, 'GitHub returned no check run name'],
      [{ contexts: [statusContext('', 'SUCCESS')] }, 'GitHub returned no status context'],
      [{ mergeState: undefined }, 'GitHub returned no merge state'],
      [{ mergeState: 4 }, 'GitHub returned no merge state'],
      [{ checksMore: true }, 'has more than 100 checks on the head'],
      [{ raw: { graphql: '\n' } }, 'gh api graphql printed nothing'],
      [{ contexts: 'x' as never }, 'GitHub returned no check list'],
      [{ contexts: [null] }, 'whether a check is required'],
      [{ contexts: [{ ...checkRun('a', 'COMPLETED'), isRequired: null }] }, 'is required'],
      [{ contexts: [{ __typename: 'Other', isRequired: false }] }, 'neither a check run nor'],
    ]
    for (const [overrides, message] of cases) {
      const result = await check(fixture(overrides), DIR)
      expect(result.stderr).toContain(message)
      expect(result.stdout).toBe('')
      expect(result.code).toBe(2)
    }
  })
})
