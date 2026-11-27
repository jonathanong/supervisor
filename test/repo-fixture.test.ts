import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { scanPolicyFiles } from '../src/policy/scan.js'
import { repoFixture } from './helpers/repo-fixture.js'

describe('repository fixtures', () => {
  it('are stored so that this checkout holds no repository policy under test/', async () => {
    // A .supervisor folder under test/ would be read as this repository's own policy for the
    // fixture's paths, so the fixtures store theirs under another name.
    const testDir = fileURLToPath(new URL('.', import.meta.url))
    expect(await scanPolicyFiles(testDir, '.supervisor')).toEqual([])
  })

  it('are copied out with their policy folders under the real name', async () => {
    const copy = await repoFixture('layered/repo-carve-out')
    const found = await scanPolicyFiles(copy, '.supervisor')
    expect(found.map((entry) => entry.relPath)).toEqual([
      '.supervisor/approvals.yml',
      'packages/app/.supervisor/approvals.yml',
    ])
  })
})
