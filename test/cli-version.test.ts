import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compareVersion,
  INSTALL_COMMAND,
  MIN_CLI_VERSION,
  parseVersion,
} from '../src/cli/version.js'
import { cleanupLoops, makeLoop } from './helpers/loop.js'

const SKILL_PATHS = [
  new URL('../skills/supervisor-loop/SKILL.md', import.meta.url),
  new URL('../skills/supervisor-sweep/SKILL.md', import.meta.url),
]

const README_URL = new URL('../README.md', import.meta.url)

const REQUIRES_RE =
  /Requires `@jongleberry\/supervisor` ([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?) or newer/g

const VERSION_CHECK_RE =
  /`supervisor --version` is (?:older than )?([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)/g

function cmp(a: string, b: string): number {
  const parsedA = parseVersion(a)
  const parsedB = parseVersion(b)
  expect(parsedA).toBeDefined()
  expect(parsedB).toBeDefined()
  return compareVersion(parsedA!, parsedB!)
}

describe('CLI semver helpers', () => {
  it('parses valid semver strings and rejects invalid ones', () => {
    expect(parseVersion('0.4.0')).toEqual({ major: 0, minor: 4, patch: 0, prerelease: undefined })
    expect(parseVersion(' v1.2.3-rc.1+build.9 ')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: 'rc.1',
    })
    expect(parseVersion('')).toBeUndefined()
    expect(parseVersion('0.4')).toBeUndefined()
    expect(parseVersion('not-a-version')).toBeUndefined()
  })

  it('orders major, minor, patch, and prerelease identifiers per semver', () => {
    expect(cmp('0.4.0', '0.4.0')).toBe(0)
    expect(cmp('0.4.0', '1.0.0')).toBeLessThan(0)
    expect(cmp('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(cmp('0.3.9', '0.4.0')).toBeLessThan(0)
    expect(cmp('0.4.0', '0.4.1')).toBeLessThan(0)
    expect(cmp('0.4.0-rc.1', '0.4.0')).toBeLessThan(0)
    expect(cmp('0.4.0', '0.4.0-rc.1')).toBeGreaterThan(0)
    expect(cmp('0.4.0-rc.1', '0.4.0-rc.1')).toBe(0)
    expect(cmp('0.4.0-rc.2', '0.4.0-rc.10')).toBeLessThan(0)
    expect(cmp('0.4.0-1', '0.4.0-alpha')).toBeLessThan(0)
    expect(cmp('0.4.0-alpha', '0.4.0-1')).toBeGreaterThan(0)
    expect(cmp('0.4.0-alpha', '0.4.0-beta')).toBeLessThan(0)
    expect(cmp('0.4.0-beta', '0.4.0-alpha')).toBeGreaterThan(0)
    expect(cmp('0.4.0-alpha', '0.4.0-alpha.1')).toBeLessThan(0)
  })
})

describe('minimum CLI version consistency', () => {
  afterEach(cleanupLoops)

  it('uses a valid semver minimum of 0.5.0', () => {
    expect(MIN_CLI_VERSION).toBe('0.5.0')
    expect(parseVersion(MIN_CLI_VERSION)).toBeDefined()
  })

  it('keeps supervisor-loop and supervisor-sweep skills in sync with preflight', () => {
    for (const url of SKILL_PATHS) {
      const content = readFileSync(url, 'utf8')
      const matches = [...content.matchAll(REQUIRES_RE)].map((m) => m[1])
      expect(matches.length, `missing minimum CLI version in ${url.pathname}`).toBeGreaterThan(0)
      for (const stated of matches) {
        expect(stated, `version mismatch in ${url.pathname}`).toBe(MIN_CLI_VERSION)
      }
      expect(content).toContain(INSTALL_COMMAND)
    }

    const sweep = readFileSync(SKILL_PATHS[1]!, 'utf8')
    const preflightMentions = [...sweep.matchAll(VERSION_CHECK_RE)].map((m) => m[1])
    expect(preflightMentions.length).toBeGreaterThan(0)
    for (const stated of preflightMentions) {
      expect(stated).toBe(MIN_CLI_VERSION)
    }
  })

  it('keeps README and preflight --help in sync with the minimum CLI version', async () => {
    const readme = readFileSync(README_URL, 'utf8')
    expect(readme).toContain(`\`supervisor --version\`, at least \`${MIN_CLI_VERSION}\``)

    const loop = await makeLoop()
    const help = await loop.cli(['preflight', '--help'])
    expect(help.code).toBe(0)
    expect(help.stdout).toContain(`is ${MIN_CLI_VERSION} or newer`)
  })
})
