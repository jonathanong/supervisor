import { afterEach, describe, expect, it, vi } from 'vitest'
import { getVersion } from '../src/cli/version.js'

describe('supervisor CLI entrypoint', () => {
  const originalArgv = process.argv
  const originalExitCode = process.exitCode

  afterEach(() => {
    process.argv = originalArgv
    process.exitCode = originalExitCode
    vi.restoreAllMocks()
  })

  it('runs the CLI against process.argv and sets process.exitCode', async () => {
    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk))
      return true
    })
    process.argv = ['node', 'supervisor', '--version']
    process.exitCode = undefined

    await import('../src/cli/index.js')

    expect(process.exitCode).toBe(0)
    expect(output.join('')).toBe(`${getVersion()}\n`)
  })
})
