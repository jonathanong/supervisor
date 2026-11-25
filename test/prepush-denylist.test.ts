import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadDenylist, parseDenylist, resolveDenylistPath } from '../src/prepush/denylist.js'
import { scanLine } from '../src/prepush/patterns.js'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'supervisor-deny-'))
  tempDirs.push(dir)
  return dir
}

describe('prepush denylist and built-in patterns', () => {
  afterEach(async () => {
    while (tempDirs.length > 0) await rm(tempDirs.pop()!, { recursive: true, force: true })
  })

  it('resolves default and overridden denylist paths', () => {
    expect(resolveDenylistPath({})).toBe(join(homedir(), '.config', 'supervisor', 'denylist.txt'))
    expect(resolveDenylistPath({ SUPERVISOR_DENYLIST: '/tmp/custom.txt' })).toBe('/tmp/custom.txt')
  })

  it('parses literal terms, regexes, and comments without leaking patterns on error', () => {
    const entries = parseDenylist(`
# comment line

secret-codename
/proj-[0-9]+/gi
`)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.entryNumber).toBe(1)
    expect(entries[1]!.entryNumber).toBe(2)

    expect(() => parseDenylist('/([unclosed-secret/')).toThrow('denylist entry #1')
    try {
      parseDenylist('/([unclosed-secret/')
    } catch (err) {
      expect((err as Error).message).not.toContain('unclosed-secret')
    }
  })

  it('loads an existing denylist, reports missing on ENOENT, and rethrows other fs errors', async () => {
    const dir = await makeTempDir()
    const missing = await loadDenylist({ SUPERVISOR_DENYLIST: join(dir, 'nope.txt') })
    expect(missing).toEqual({ status: 'missing', path: join(dir, 'nope.txt') })

    const filePath = join(dir, 'deny.txt')
    await writeFile(filePath, 'private-token\n', 'utf8')
    const loaded = await loadDenylist({ SUPERVISOR_DENYLIST: filePath })
    expect(loaded.status).toBe('loaded')

    await expect(loadDenylist({ SUPERVISOR_DENYLIST: dir })).rejects.toThrow()
  })

  it('matches denylist entries, non-noreply emails, and private hostnames/IPs', () => {
    const entries = parseDenylist('secret-org\n/internal_[0-9]+/\n')

    expect(scanLine('https://github.com/jonathanong/supervisor', 'README.md', 1, entries)).toEqual(
      [],
    )
    expect(scanLine('Co-Authored-By: Bot <noreply@example.com>', 'commit', 1, entries)).toEqual([])

    expect(scanLine('Belongs to SECRET-ORG', 'doc.md', 4, entries)).toEqual([
      { location: 'doc.md', line: 4, rule: 'denylist entry #1' },
    ])
    expect(scanLine('id=internal_42', 'src/a.ts', 9, entries)).toEqual([
      { location: 'src/a.ts', line: 9, rule: 'denylist entry #2' },
    ])
    expect(scanLine('contact alice@example.com', 'doc.md', 2, entries)).toEqual([
      { location: 'doc.md', line: 2, rule: 'built-in email' },
    ])
    expect(scanLine('host db.prod.internal', 'cfg.json', 3, entries)).toEqual([
      { location: 'cfg.json', line: 3, rule: 'built-in hostname' },
    ])
    expect(scanLine('http://10.20.30.40:8080', 'cfg.json', 5, entries)).toEqual([
      { location: 'cfg.json', line: 5, rule: 'built-in hostname' },
    ])
  })
})
