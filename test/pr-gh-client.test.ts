import { describe, expect, it } from 'vitest'
import { ghJson, ghJsonLines, PrToolError } from '../src/pr/gh-client.js'

const run = (stdout: string) => async () => ({ code: 0, stdout, stderr: '' })

async function caught(promise: Promise<unknown>): Promise<PrToolError> {
  try {
    await promise
  } catch (err) {
    return err as PrToolError
  }
  throw new Error('expected a rejection')
}

describe('gh client errors', () => {
  it('keeps the parse error as the cause and sets a code', async () => {
    const single = await caught(ghJson(run('{bad'), [], 'x'))
    expect(single).toBeInstanceOf(PrToolError)
    expect(single.code).toBe('gh-invalid-response')
    expect(single.cause).toBeInstanceOf(SyntaxError)

    const lines = await caught(ghJsonLines(run('{bad\n'), [], 'x'))
    expect(lines.code).toBe('gh-invalid-response')
    expect(lines.cause).toBeInstanceOf(SyntaxError)
  })

  it('defaults details to an empty object and has no cause', () => {
    expect(new PrToolError('not-found', 'm').details).toEqual({})
    expect(new PrToolError('not-found', 'm').cause).toBeUndefined()
  })
})
