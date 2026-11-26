import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLoops, makeLoop, type Loop } from './helpers/loop.js'

const docs = { purpose: 'Docs-only changes merge', sourceFile: '.claude/approvals.yml' }
const locks = { purpose: 'Lockfiles merge for the dependency bot', sourceFile: 'a.yml' }
const records = [
  { pr: 'example-org/example-repo#1', head: 'a', rules: [docs] },
  { pr: 'Example-Org/Example-Repo#2', head: 'b', rules: [locks, docs] },
  { pr: 'example-org/example-repo-2#3', head: 'c', rules: [locks] },
  { pr: 'example-user/example-repo#4', head: 'd', rules: ['junk', { purpose: 7 }] },
  { pr: 'example-org/example-repo#5', head: 'e', rules: 'hand-built' },
  { head: 'f' },
  'hand-built',
]

/** The `head` of each record `state merge-records` prints; a record that is not an object is `-`. */
async function heads(loop: Loop, args: string[] = []): Promise<string[]> {
  const listed = await loop.cli(['state', 'merge-records', ...args])
  expect(listed).toMatchObject({ code: 0, stderr: '' })
  const lines = listed.stdout.split('\n').filter(Boolean)
  return lines.map((line) => JSON.parse(line).head ?? '-')
}

describe('supervisor state merge-records', () => {
  afterEach(cleanupLoops)

  it('prints every record, one JSON line each, and nothing when there are none', async () => {
    const loop = await makeLoop()
    expect(await loop.cli(['state', 'merge-records'])).toEqual({ code: 0, stdout: '', stderr: '' })
    await loop.seed({ mergeRecords: records })
    expect(await heads(loop)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', '-'])
    expect((await loop.cli(['state', 'merge-records'])).stdout.split('\n')[0]).toBe(
      '{"pr": "example-org/example-repo#1", "head": "a", "rules": ' +
        '[{"purpose": "Docs-only changes merge", "sourceFile": ".claude/approvals.yml"}]}',
    )
  })

  it('filters by repository and by rule purpose, ignoring case', async () => {
    const loop = await makeLoop()
    await loop.seed({ mergeRecords: records })
    expect(await heads(loop, ['--repo', 'example-org/example-repo'])).toEqual(['a', 'b', 'e'])
    expect(await heads(loop, ['--repo', 'EXAMPLE-USER/example-repo'])).toEqual(['d'])
    expect(await heads(loop, ['--repo', 'example-org/absent'])).toEqual([])
    expect(await heads(loop, ['--rule', 'lockfiles'])).toEqual(['b', 'c'])
    expect(await heads(loop, ['--rule', 'merge'])).toEqual(['a', 'b', 'c'])
    expect(
      await heads(loop, ['--rule', 'DOCS-only', '--repo', 'example-org/example-repo']),
    ).toEqual(['a', 'b'])
    expect(await heads(loop, ['--rule', 'no such rule'])).toEqual([])
  })

  it('exits 2 for a malformed repository and 1 for a field that is not a list', async () => {
    const loop = await makeLoop()
    const usage = await loop.cli(['state', 'merge-records', '--repo', 'example-repo'])
    expect(usage.code).toBe(2)
    expect(usage.stderr).toContain("--repo 'example-repo' must look like owner/repo")
    expect((await loop.cli(['state', 'merge-records', 'extra'])).code).toBe(2)
    await loop.seed({ mergeRecords: {} })
    expect(await loop.cli(['state', 'merge-records'])).toMatchObject({
      code: 1,
      stderr: 'state.json: mergeRecords must be array, got object\n',
    })
  })

  it('is never written by set or append, and remove can still clear it', async () => {
    const loop = await makeLoop()
    await loop.seed({ mergeRecords: records.slice(0, 1) })
    for (const args of [
      ['set', 'mergeRecords', '--json', '[]'],
      ['append', 'mergeRecords', '--json', '{"pr":"x"}'],
    ]) {
      expect(await loop.cli(['state', ...args])).toEqual({
        code: 1,
        stdout: '',
        stderr:
          'supervisor state: mergeRecords is written only by "supervisor state merge-record"\n',
      })
    }
    expect((await loop.state()).mergeRecords).toHaveLength(1)
    expect((await loop.cli(['state', 'remove', 'mergeRecords'])).stdout).toContain('removed')
  })

  it('takes no lock, so a held state lock does not block the listing', async () => {
    const loop = await makeLoop()
    await loop.seed({ mergeRecords: records.slice(0, 1) })
    await mkdir(loop.stateDir, { recursive: true })
    await writeFile(join(loop.stateDir, 'state.lock'), `${process.pid} held-by-this-test`)
    expect(await heads(loop)).toEqual(['a'])
  })
})
