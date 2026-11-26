import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { runCli, type CliIo } from '../src/cli/run.js'

const fixture = (rel: string) =>
  fileURLToPath(new URL(`./fixtures/policies/${rel}`, import.meta.url))
const invalidJson = fileURLToPath(new URL('./fixtures/invalid-json.txt', import.meta.url))

function createTestIo() {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = {
    env: {},
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    startMcp: vi.fn(async () => undefined),
    runProcess: vi.fn(),
    now: () => new Date(0),
  }
  return { io, stdout: () => out.join(''), stderr: () => err.join('') }
}

describe('supervisor policy CLI', () => {
  it('explains all policies in a directory and for a specific path', async () => {
    const overview = createTestIo()
    expect(await runCli(['policy', 'explain', fixture('nested-inherit')], overview.io)).toBe(0)
    expect(overview.stdout()).toContain('.claude/approvals.yml')
    expect(overview.stdout()).toContain('services/payments/.claude/approvals.yml')

    const targeted = createTestIo()
    expect(
      await runCli(
        ['policy', 'explain', fixture('nested-inherit'), 'services/payments/src/charge.ts'],
        targeted.io,
      ),
    ).toBe(0)
    expect(targeted.stdout()).toContain('Deciding policy: services/payments/.claude/approvals.yml')
    expect(targeted.stdout()).toContain('nested:inherit')

    const uncovered = createTestIo()
    expect(
      await runCli(['policy', 'explain', fixture('docs-light'), 'src/unmatched.ts'], uncovered.io),
    ).toBe(0)
    expect(uncovered.stdout()).toContain('Uncovered')

    const empty = createTestIo()
    expect(await runCli(['policy', 'explain', fixture('inputs')], empty.io)).toBe(0)
    expect(empty.stdout()).toContain('No policy files found.')
  })

  it('runs policy check in human-readable and --json formats with exit codes 0, 1, 2', async () => {
    const passHuman = createTestIo()
    expect(
      await runCli(
        [
          'policy',
          'check',
          '--dir',
          fixture('docs-light'),
          '--input',
          fixture('inputs/docs-pass.json'),
        ],
        passHuman.io,
      ),
    ).toBe(0)
    expect(passHuman.stdout()).toContain('Next step: merge allowed')

    const passJson = createTestIo()
    expect(
      await runCli(
        [
          'policy',
          'check',
          '--dir',
          fixture('sensitive-deep'),
          '--input',
          fixture('inputs/sensitive-pass.json'),
          '--json',
        ],
        passJson.io,
      ),
    ).toBe(1)
    const parsed = JSON.parse(passJson.stdout()) as {
      reviewDepth: string
      nextStep: { action: string }
    }
    expect(parsed.reviewDepth).toBe('deep')
    // A `comments` verdict goes to a person even when its seats are filled.
    expect(parsed.nextStep.action).toBe('escalate')

    const reviewReq = createTestIo()
    expect(
      await runCli(
        [
          'policy',
          'check',
          '--dir',
          fixture('nested-inherit'),
          '--input',
          fixture('inputs/docs-pass.json'),
        ],
        reviewReq.io,
      ),
    ).toBe(1)
    expect(reviewReq.stdout()).toContain('Next step: request review at depth standard')

    const escalate = createTestIo()
    expect(
      await runCli(
        [
          'policy',
          'check',
          '--dir',
          fixture('sensitive-deep'),
          '--input',
          fixture('inputs/sensitive-unapproved.json'),
        ],
        escalate.io,
      ),
    ).toBe(1)
    expect(escalate.stdout()).toContain('Next step: escalate to a person')

    const warn = createTestIo()
    expect(
      await runCli(
        [
          'policy',
          'check',
          '--dir',
          fixture('author-only'),
          '--input',
          fixture('inputs/sensitive-pass.json'),
        ],
        warn.io,
      ),
    ).toBe(0)
    expect(warn.stdout()).toContain('Warning:')
  })

  it('exits 2 on invalid policies, bad input JSON, or usage errors', async () => {
    const docs = ['--dir', fixture('docs-light')]
    const cases: string[][] = [
      ['policy'],
      ['policy', 'unknown'],
      ['policy', 'explain'],
      ['policy', 'explain', fixture('unknown-key')],
      ['policy', 'check'],
      ['policy', 'check', '--bogus'],
      [
        'policy',
        'check',
        '--dir',
        fixture('unknown-key'),
        '--input',
        fixture('inputs/docs-pass.json'),
      ],
      ['policy', 'check', '--dir', fixture('docs-light'), '--input', invalidJson],
      [
        'policy',
        'check',
        '--dir',
        fixture('docs-light'),
        '--input',
        fixture('../../../examples/config.example.json'),
      ],
      ['policy', 'check', 'example-org/example-repo'],
      ['policy', 'check', 'not-a-repo', '7', ...docs],
      ['policy', 'check', '../example-repo', '7', ...docs],
      ['policy', 'check', 'example-org/..', '7', ...docs],
      ['policy', 'check', 'example-org/example-repo', '0', ...docs],
      ['policy', 'check', ...docs, '--input', fixture('inputs/docs-pass.json'), '--print-input'],
      [
        'policy',
        'check',
        ...docs,
        '--input',
        fixture('inputs/docs-pass.json'),
        '--classifiers',
        'x',
      ],
    ]
    for (const argv of cases) {
      const testIo = createTestIo()
      expect(await runCli(argv, testIo.io)).toBe(2)
      expect(testIo.stderr().length).toBeGreaterThan(0)
    }
  })
})
