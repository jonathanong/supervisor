import { describe, expect, it } from 'vitest'
import {
  matchGlob,
  matchesRulePaths,
  toRelativePath,
  validatePathPattern,
} from '../src/policy/glob.js'

describe('policy glob matching and validation', () => {
  it('validates path patterns per approvals.yml rules', () => {
    expect(validatePathPattern('**/*.ts')).toBeNull()
    expect(validatePathPattern('!docs/**')).toBeNull()
    expect(validatePathPattern('\\@scoped/file.ts')).toBeNull()
    expect(validatePathPattern('\\!literal.txt')).toBeNull()
    expect(validatePathPattern('')).toContain('empty')
    expect(validatePathPattern('!')).toContain('Negated')
    expect(validatePathPattern('! docs/**')).toContain('Negated')
    expect(validatePathPattern('/leading.ts')).toContain('slash')
    expect(validatePathPattern('trailing/')).toContain('slash')
    expect(validatePathPattern('./local.ts')).toContain('dot')
    expect(validatePathPattern('.')).toContain('dot')
    expect(validatePathPattern('..')).toContain('dot')
    expect(validatePathPattern('a//b.ts')).toContain('invalid')
    expect(validatePathPattern('a/../b.ts')).toContain('invalid')
    expect(validatePathPattern('**.go')).toContain('Double-star')
  })

  it('matches *, **, ?, character classes, braces, and escapes', () => {
    expect(matchGlob('README.md', '*.md')).toBe(true)
    expect(matchGlob('docs/README.md', '*.md')).toBe(false)
    expect(matchGlob('docs/README.md', '**/*.md')).toBe(true)
    expect(matchGlob('.github/README.md', '**/*.md')).toBe(true)
    expect(matchGlob('README.md', '**/*.md')).toBe(true)
    expect(matchGlob('dir', 'dir/**')).toBe(true)
    expect(matchGlob('dir/a/b.ts', 'dir/**')).toBe(true)
    expect(matchGlob('anything/at/all', '**')).toBe(true)
    expect(matchGlob('a1.ts', 'a?.ts')).toBe(true)
    expect(matchGlob('a12.ts', 'a?.ts')).toBe(false)
    expect(matchGlob('package-lock.json', '{package,package-lock}.json')).toBe(true)
    expect(matchGlob('src/a.ts', 'src/[ab].ts')).toBe(true)
    expect(matchGlob('app/[id]/page.ts', 'app/\\[id\\]/page.ts')).toBe(true)
    expect(matchGlob('weird{name', 'weird{name')).toBe(true)
    expect(matchGlob('weird[name', 'weird[name')).toBe(true)
    expect(matchGlob('@file.ts', '\\@file.ts')).toBe(true)
  })

  it('applies positive and negated patterns in matchesRulePaths', () => {
    expect(matchesRulePaths('src/app.ts', ['**', '!docs/**'])).toBe(true)
    expect(matchesRulePaths('docs/guide.md', ['**', '!docs/**'])).toBe(false)
    expect(matchesRulePaths('other.txt', ['src/**'])).toBe(false)
  })

  // TODO(spec): confirm whether a positive pattern after a `!` pattern re-includes excluded files.
  it.skip('positive pattern after negation re-inclusion behavior', () => {
    expect(matchesRulePaths('docs/public.md', ['**', '!docs/**', 'docs/public.md'])).toBe(true)
  })

  it('computes relative paths against policy baseDir', () => {
    expect(toRelativePath('src/a.ts', '')).toBe('src/a.ts')
    expect(toRelativePath('services/pay/a.ts', 'services/pay')).toBe('a.ts')
    expect(toRelativePath('services/pay', 'services/pay')).toBe('')
    expect(toRelativePath('other/a.ts', 'services/pay')).toBeNull()
  })
})
