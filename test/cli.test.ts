import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultCliIo, runCli, type CliIo } from '../src/cli/run.js'
import { getVersion } from '../src/cli/version.js'

const exampleConfigPath = fileURLToPath(new URL('../examples/config.example.json', import.meta.url))
const invalidConfigPath = fileURLToPath(new URL('./fixtures/invalid-config.json', import.meta.url))

function createTestIo(env: Record<string, string | undefined> = {}) {
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  const startMcp = vi.fn(async (_version: string) => undefined)
  const io: CliIo = {
    env,
    stdout: (text) => stdoutChunks.push(text),
    stderr: (text) => stderrChunks.push(text),
    startMcp,
    runProcess: vi.fn(),
    now: () => new Date(0),
  }
  return {
    io,
    startMcp,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  }
}

describe('supervisor CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints version for --version and -V', async () => {
    const expected = `${getVersion()}\n`
    for (const flag of ['--version', '-V']) {
      const testIo = createTestIo()
      const code = await runCli([flag], testIo.io)
      expect(code).toBe(0)
      expect(testIo.stdout()).toBe(expected)
      expect(testIo.stderr()).toBe('')
    }
  })

  it('prints help for --help and -h', async () => {
    for (const flag of ['--help', '-h']) {
      const testIo = createTestIo()
      const code = await runCli([flag], testIo.io)
      expect(code).toBe(0)
      expect(testIo.stdout()).toContain('Usage: supervisor')
      expect(testIo.stdout()).toContain('config validate [path]')
      expect(testIo.stderr()).toBe('')
    }
  })

  it('returns exit code 2 for usage errors', async () => {
    const cases: string[][] = [
      [],
      ['unknown'],
      ['config'],
      ['config', 'unknown'],
      ['config', 'validate', exampleConfigPath, 'extra'],
      ['config', 'validate'],
      ['mcp', 'extra'],
    ]
    for (const argv of cases) {
      const testIo = createTestIo()
      const code = await runCli(argv, testIo.io)
      expect(code).toBe(2)
      expect(testIo.stderr().length).toBeGreaterThan(0)
    }
  })

  it('validates an explicit config path and exits 0', async () => {
    const testIo = createTestIo()
    const code = await runCli(['config', 'validate', exampleConfigPath], testIo.io)
    expect(code).toBe(0)
    expect(testIo.stdout()).toContain(exampleConfigPath)
    expect(testIo.stderr()).toBe('')
  })

  it('defaults config validate path to $SUPERVISOR_CONFIG', async () => {
    const testIo = createTestIo({ SUPERVISOR_CONFIG: exampleConfigPath })
    const code = await runCli(['config', 'validate'], testIo.io)
    expect(code).toBe(0)
    expect(testIo.stdout()).toContain(exampleConfigPath)
  })

  it('prints JSON paths and exits 1 for an invalid config file', async () => {
    const testIo = createTestIo()
    const code = await runCli(['config', 'validate', invalidConfigPath], testIo.io)
    expect(code).toBe(1)
    expect(testIo.stderr()).toContain('/scopes/0/kind:')
    expect(testIo.stderr()).toContain('/mergeAuthority:')
    expect(testIo.stderr()).toContain('/: ')
  })

  it('starts the MCP server with the package version', async () => {
    const testIo = createTestIo()
    const code = await runCli(['mcp'], testIo.io)
    expect(code).toBe(0)
    expect(testIo.startMcp).toHaveBeenCalledWith(getVersion())
  })

  it('writes to process streams via defaultCliIo', async () => {
    const outChunks: string[] = []
    const errChunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      outChunks.push(String(chunk))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errChunks.push(String(chunk))
      return true
    })

    expect(await runCli(['--version'])).toBe(0)
    expect(outChunks.join('')).toBe(`${getVersion()}\n`)

    defaultCliIo.stderr('usage error\n')
    expect(errChunks.join('')).toBe('usage error\n')
  })
})
