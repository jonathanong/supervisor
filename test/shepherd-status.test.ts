import { describe, expect, it, vi } from 'vitest'

const answers = vi.hoisted(() => ({ next: {} as Record<string, unknown> }))
const calls = vi.hoisted(() => ({ iterate: 0, created: [] as unknown[], status: [] as unknown[] }))

vi.mock('pr-shepherd', () => ({
  createPrShepherd: (options: unknown) => {
    calls.created.push(options)
    return {
      iterate: async () => {
        calls.iterate += 1
      },
      status: async (input: unknown) => {
        calls.status.push(input)
        return answers.next
      },
    }
  },
}))

const { shepherdStatus } = await import('../src/cli/shepherd-status.js')

describe('the default pr-shepherd status', () => {
  it('reads the status in the given directory and never iterates', async () => {
    answers.next = { action: 'wait', headSha: 'abc', log: 'checks pending', pr: 7 }
    const answer = await shepherdStatus('example-org/example-repo#7', '/work/example-repo')
    expect(answer).toEqual({ action: 'wait', headSha: 'abc', log: 'checks pending' })
    expect(calls.created).toEqual([{ cwd: '/work/example-repo' }])
    expect(calls.status).toEqual([
      { pr: 'example-org/example-repo#7', merge: true, readyDelaySeconds: 0 },
    ])
    expect(calls.iterate).toBe(0)
  })

  it('leaves out the head and the log an answer does not have', async () => {
    answers.next = { action: 'triage', triage: {} }
    expect(await shepherdStatus('example-org/example-repo#7', '.')).toEqual({ action: 'triage' })
  })
})
