import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { INSTALL_COMMAND, MIN_CLI_VERSION } from '../src/cli/version.js'
import type { RunProcess } from '../src/state/process.js'
import { cleanupLoops, done, makeLoop, NOW } from './helpers/loop.js'
import { fake, GOOD } from './helpers/preflight.js'

describe('supervisor preflight details', () => {
  afterEach(cleanupLoops)

  it('keeps every detail to one line, the first non-empty one of the output', async () => {
    const loop = await makeLoop()
    const replies = {
      supervisor: done('', 127, 'supervisor: command not found\n'),
      gh: done('', 1, `\n\nbad credentials\nrun gh auth login\n`),
      'pr-shepherd': done('', 1),
    }
    const result = await loop.cli(['preflight'], fake(replies).run)
    expect(result.stdout).toContain(
      `FAIL supervisor: exited 127: supervisor: command not found; need ${MIN_CLI_VERSION} or newer, run: ${INSTALL_COMMAND}\n`,
    )
    expect(result.stdout).toContain('FAIL gh: exited 1: bad credentials\n')
    expect(result.stdout).toContain('FAIL pr-shepherd: exited 1: \n')
    const thrown = { ...GOOD, 'pr-shepherd': new Error('first\nsecond') }
    expect((await loop.cli(['preflight'], fake(thrown).run)).stdout).toContain(
      'FAIL pr-shepherd: first\n',
    )
    const long = { ...GOOD, 'pr-shepherd': done('x'.repeat(500), 1) }
    const capped = await loop.cli(['preflight'], fake(long).run)
    expect(capped.stdout).toContain(`exited 1: ${'x'.repeat(200)}\n`)
    const longVersion = { ...GOOD, supervisor: done('x'.repeat(500)) }
    const cappedVersion = await loop.cli(['preflight'], fake(longVersion).run)
    expect(cappedVersion.stdout).toContain(
      `FAIL supervisor: cannot parse version "${'x'.repeat(200)}"; need ${MIN_CLI_VERSION} or newer, run: ${INSTALL_COMMAND}\n`,
    )
  })

  it('keeps a multi-line stop reason to one line', async () => {
    const loop = await makeLoop()
    await loop.cli(['stop', '--reason', 'CI is broken\nsecond line'])
    const result = await loop.cli(['preflight'], fake(GOOD).run)
    expect(result.stdout).toContain(`FAIL stop: stopped since ${NOW}: CI is broken\n`)
    expect(result.stdout).not.toContain('second line')
  })

  it('reports hook-harness as failed when the config file cannot be re-read', async () => {
    const loop = await makeLoop()
    const path = loop.env.SUPERVISOR_CONFIG!
    const run: RunProcess = async (command) => {
      if (command === 'gh') {
        await writeFile(path, '{ half written')
      }
      return GOOD[command as keyof typeof GOOD]!
    }
    const result = await loop.cli(['preflight'], run)
    expect(result.code).toBe(1)
    expect(result.stdout).toMatch(/\nFAIL hook-harness: [^\n]+\n/)
    expect(result.stdout).toContain('ok   config: ')
  })

  it('checks hook-harness credentials from client.json and validates the relay URL scheme', async () => {
    const loop = await makeLoop()
    delete loop.env.HOOK_HARNESS_URL
    delete loop.env.HOOK_HARNESS_TOKEN
    const missing = await loop.cli(['preflight'], fake(GOOD).run)
    expect(missing.code).toBe(1)
    expect(missing.stdout).toContain('FAIL hook-harness: not logged in;')

    await mkdir(loop.env.HOOK_HARNESS_CONFIG_DIR!, { recursive: true })
    await writeFile(
      join(loop.env.HOOK_HARNESS_CONFIG_DIR!, 'client.json'),
      JSON.stringify({ url: 'http://127.0.0.1:8787/prefix', token: 'hh_saved' }),
    )
    const loopback = await loop.cli(['preflight'], fake(GOOD).run)
    expect(loopback.code).toBe(0)
    expect(loopback.stdout).toContain('ok   hook-harness: http://127.0.0.1:8787\n')

    loop.env.HOOK_HARNESS_URL = 'http://relay.example.test'
    const insecure = await loop.cli(['preflight'], fake(GOOD).run)
    expect(insecure.code).toBe(1)
    expect(insecure.stdout).toContain(
      'FAIL hook-harness: refusing to send the token to http://relay.example.test; use https\n',
    )

    loop.env.HOOK_HARNESS_URL = 'not-a-url'
    const invalid = await loop.cli(['preflight'], fake(GOOD).run)
    expect(invalid.code).toBe(1)
    expect(invalid.stdout).toContain('FAIL hook-harness: Invalid URL\n')
  })
})
