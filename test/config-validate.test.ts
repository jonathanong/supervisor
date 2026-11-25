import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateConfigData, validateConfigFile } from '../src/cli/config-validate.js'

const exampleConfigPath = fileURLToPath(new URL('../examples/config.example.json', import.meta.url))
const invalidJsonPath = fileURLToPath(new URL('./fixtures/invalid-json.txt', import.meta.url))
const invalidConfigPath = fileURLToPath(new URL('./fixtures/invalid-config.json', import.meta.url))

function loadExampleConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(exampleConfigPath, 'utf8')) as Record<string, unknown>
}

describe('config validation', () => {
  it('accepts examples/config.example.json', async () => {
    const result = await validateConfigFile(exampleConfigPath)
    expect(result).toEqual({ valid: true })
  })

  it('rejects additional properties at each structured level with JSON paths', () => {
    const config = loadExampleConfig()
    config.unexpectedTop = true
    ;(config.scopes as Record<string, unknown>[])[0]!.unexpectedScope = true
    ;(config.provenance as Record<string, unknown>).unexpectedProvenance = true
    ;(config.mergeAuthority as Record<string, unknown>).unexpectedAuthority = true
    ;(config.finalReview as Record<string, unknown>).unexpectedReview = true

    const result = validateConfigData(config)
    expect(result.valid).toBe(false)
    if (result.valid) return

    const paths = result.errors.map((error) => error.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/scopes/0')
    expect(paths).toContain('/provenance')
    expect(paths).toContain('/mergeAuthority')
    expect(paths).toContain('/finalReview')
    expect(result.errors.some((error) => error.message.includes('unexpectedTop'))).toBe(true)
  })

  it('rejects invalid enums and repos values', () => {
    const config = loadExampleConfig()
    const firstScope = (config.scopes as Record<string, unknown>[])[0]!
    firstScope.kind = 'enterprise'
    firstScope.repos = 'single-repo'
    ;(config.mergeAuthority as Record<string, unknown>).policyEngine = 'unknown'

    const result = validateConfigData(config)
    expect(result.valid).toBe(false)
    if (result.valid) return

    const paths = result.errors.map((error) => error.path)
    expect(paths).toContain('/scopes/0/kind')
    expect(paths).toContain('/scopes/0/repos')
    expect(paths).toContain('/mergeAuthority/policyEngine')
  })

  it('allows taxonomy objects with arbitrary keys', () => {
    const config = loadExampleConfig()
    ;(config.scopes as Record<string, unknown>[])[0]!.taxonomy = {
      labels: ['bug', 'chore'],
    }
    expect(validateConfigData(config)).toEqual({ valid: true })
  })

  it('reports file read errors at root path', async () => {
    const result = await validateConfigFile('/nonexistent/supervisor-config.json')
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.path).toBe('/')
    expect(result.errors[0]!.message).toContain('Cannot read file:')
  })

  it('reports invalid JSON syntax at root path', async () => {
    const result = await validateConfigFile(invalidJsonPath)
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.path).toBe('/')
    expect(result.errors[0]!.message).toContain('Invalid JSON:')
  })

  it('reports schema errors from invalid fixture file', async () => {
    const result = await validateConfigFile(invalidConfigPath)
    expect(result.valid).toBe(false)
    if (result.valid) return
    const paths = result.errors.map((error) => error.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/scopes/0/kind')
    expect(paths).toContain('/mergeAuthority')
    expect(paths).toContain('/finalReview/request/0')
  })
})
