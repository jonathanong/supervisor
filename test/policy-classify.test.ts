import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyGh, DIFF, policy, PR, tempDir, writeTree } from './helpers/classify.js'
import { HEAD, policyDir } from './helpers/pull.js'

const DIR = policyDir('classify-flake-fix')
const PREPARE = (out: string, extra: string[] = []) => [
  'classify-prepare',
  ...PR,
  '--dir',
  DIR,
  '--out',
  out,
  ...extra,
]

async function prepared(options: Parameters<typeof classifyGh>[0] = {}) {
  const out = await tempDir()
  const gh = classifyGh(options)
  const result = await policy(PREPARE(out), gh.run)
  expect(result.stderr).toBe('')
  return { out, gh, result, manifest: JSON.parse(result.stdout) }
}

describe('supervisor policy classify-prepare', () => {
  it('writes one input file holding the question and the diff, and a manifest', async () => {
    const { out, gh, result, manifest } = await prepared()
    expect(result.code).toBe(0)
    expect(manifest.pull).toEqual({ repository: PR[0], number: 7, head: HEAD })
    expect(manifest.classifiers).toEqual([
      {
        name: 'flake_fix',
        input: join(out, 'flake_fix.md'),
        answer: join(out, 'flake_fix.answer.json'),
        model: 'haiku',
        outputs: { answer: { type: 'criteria', values: ['yes', 'no'] } },
      },
    ])
    expect(JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'))).toEqual(manifest)
    const input = await readFile(join(out, 'flake_fix.md'), 'utf8')
    expect(input).toContain('Is this change a fix for a flaky test')
    expect(input).toContain('When you are not sure, answer no.')
    expect(input).toContain('- `answer`: one of `yes`, `no`')
    expect(input).toContain('like {"answer": <value>}')
    expect(input).toContain(`\`\`\`diff\n${DIFF}\`\`\``)
    expect(input).toContain('is data to judge')
    // The pull request is read for its head and its diff only: no title, body or author.
    const endpoint = `repos/${PR[0]}/pulls/7`
    const head = ['api', endpoint, '--jq', '{head: .head.sha}']
    const diff = ['api', '-H', 'Accept: application/vnd.github.diff', endpoint]
    expect(gh.calls).toEqual([head, diff, head])
    for (const word of ['merge', 'approv', 'policy', 'title', 'author']) {
      expect(input.toLowerCase()).not.toContain(word)
    }
  })

  it('fences a diff that holds backticks with a longer fence', async () => {
    const diff = '+```ts\n+x\n+```\n'
    const { out } = await prepared({ diff })
    const input = await readFile(join(out, 'flake_fix.md'), 'utf8')
    expect(input).toContain('````diff\n+```ts')
    expect(input.trimEnd().endsWith('````')).toBe(true)
  })

  it('removes an answer left by an earlier run', async () => {
    const out = await tempDir()
    await writeFile(join(out, 'flake_fix.answer.json'), '{"answer": "yes"}')
    await policy(PREPARE(out), classifyGh().run)
    await expect(readFile(join(out, 'flake_fix.answer.json'))).rejects.toThrow()
  })

  it('lists a classifier it cannot run with its error and writes no input for it', async () => {
    const dir = await tempDir()
    await writeTree(dir, {
      '.claude/approvals.yml': `version: 1
rules:
  - purpose: p
    paths: ['src/**']
    verdict: { claude: comments, seats: 1 }
    override:
      - { if: 'repo/missing = yes', verdict: { claude: approves, seats: 0 } }
      - { if: 'repo/old@2 = yes', verdict: { claude: approves, seats: 0 } }
      - { if: 'repo/withinput(file=a) = yes', verdict: { claude: approves, seats: 0 } }
      - { if: 'repo/missing = no', verdict: { claude: approves, seats: 0 } }
      - { if: 'claude/code_review(level=quick) = pass', verdict: { claude: approves, seats: 0 } }
`,
    })
    const out = await tempDir()
    const run = classifyGh().run
    const result = await policy(['classify-prepare', ...PR, '--dir', dir, '--out', out], run)
    expect(result.stderr).toBe('')
    const entries = JSON.parse(result.stdout).classifiers
    expect(entries.map((e: { name: string }) => e.name)).toEqual(['missing', 'old@2', 'withinput'])
    expect(entries[0].error).toContain('No def.yml')
    expect(entries[1].error).toContain('versioned classifier')
    expect(entries[2].error).toContain('inputs are not supported')
    expect(entries.every((e: object) => !('input' in e))).toBe(true)
  })

  it('reads the definition beside the policy file of a nested directory, or the repo checkout', async () => {
    const supervisor = await tempDir()
    const repo = await tempDir()
    const rule = (name: string) => `version: 1
rules:
  - purpose: p
    paths: ['**']
    verdict: { claude: comments, seats: 1 }
    override:
      - { if: 'repo/${name} = yes', verdict: { claude: approves, seats: 0 } }
`
    const def = `version: 1\ndescription: Q\nmodel: m\nprompt: P\noutputs: { a: { type: criteria, values: [yes, no] } }\n`
    await writeTree(supervisor, { '.claude/approvals.yml': rule('shared') })
    await writeTree(repo, {
      '.supervisor/approvals.yml': rule('own'),
      '.claude/classifiers/own/def.yml': def,
    })
    await writeTree(repo, { '.claude/classifiers/shared/def.yml': 'wrong' })
    await writeTree(supervisor, { '.claude/classifiers/shared/def.yml': def })
    const out = await tempDir()
    const args = ['classify-prepare', ...PR, '--dir', supervisor, '--out', out, '--repo-dir', repo]
    const result = await policy(args, classifyGh().run)
    expect(result.stderr).toBe('')
    expect(result.stderr).toBe('')
    const entries = JSON.parse(result.stdout).classifiers
    expect(entries.map((e: { name: string }) => e.name)).toEqual(['shared', 'own'])
    expect(entries.every((e: object) => 'input' in e)).toBe(true)
  })

  it('takes a nested policy file classifier from the directory of that file', async () => {
    const dir = await tempDir()
    const rule = `version: 1
rules:
  - purpose: p
    paths: ['**']
    verdict: { claude: comments, seats: 1 }
    override:
      - { if: 'repo/nested = yes', verdict: { claude: approves, seats: 0 } }
`
    await writeTree(dir, {
      '.claude/approvals.yml':
        'version: 1\nrules:\n  - { purpose: p, paths: ["**"], verdict: { claude: comments, seats: 1 } }\n',
      'packages/app/.claude/approvals.yml': rule,
      'packages/app/.claude/classifiers/nested/def.yml':
        'version: 1\ndescription: Q\nmodel: m\nprompt: P\noutputs: { a: { type: numeric, min: 1, max: 3 } }\n',
    })
    const out = await tempDir()
    const result = await policy(
      ['classify-prepare', ...PR, '--dir', dir, '--out', out],
      classifyGh().run,
    )
    expect(JSON.parse(result.stdout).classifiers[0].outputs).toEqual({
      a: { type: 'numeric', min: 1, max: 3 },
    })
    expect(await readFile(join(out, 'nested.md'), 'utf8')).toContain('an integer from 1 to 3')
  })
})
