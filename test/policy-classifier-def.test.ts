import { describe, expect, it } from 'vitest'
import { loadClassifierDef } from '../src/policy/classifier-def.js'
import { tempDir, writeTree } from './helpers/classify.js'

const BASE = `version: 1
description: Is it a flake fix?
model: haiku
`
const OUTPUTS = `outputs:
  answer:
    type: criteria
    values: [yes, no]
`

async function load(files: Record<string, string>, name = 'x') {
  const root = await tempDir()
  await writeTree(root, Object.fromEntries(Object.entries(files).map(([k, v]) => [`x/${k}`, v])))
  return await loadClassifierDef(root, name)
}

const refusal = (files: Record<string, string>, name?: string) =>
  load(files, name).then(
    () => 'loaded',
    (err: Error) => err.message,
  )

describe('loadClassifierDef', () => {
  it('loads an inline prompt and each output type', async () => {
    const def = await load({
      'def.yml': `${BASE}prompt: Say yes.
outputs:
  a: { type: criteria, values: [yes, no] }
  b: { type: ordinal, values: [low, high] }
  c: { type: numeric, min: 0, max: 5 }
`,
    })
    expect(def).toEqual({
      description: 'Is it a flake fix?',
      model: 'haiku',
      prompt: 'Say yes.',
      outputs: {
        a: { type: 'criteria', values: ['yes', 'no'] },
        b: { type: 'ordinal', values: ['low', 'high'] },
        c: { type: 'numeric', min: 0, max: 5 },
      },
    })
  })

  it('loads def.yaml and a prompt.md', async () => {
    const def = await load({ 'def.yaml': BASE + OUTPUTS, 'prompt.md': 'Say no.\n' })
    expect(def.prompt).toBe('Say no.\n')
  })

  it('refuses a missing, doubled or unreadable definition', async () => {
    expect(await refusal({})).toContain('No def.yml or def.yaml')
    expect(await refusal({ 'def.yml': BASE + OUTPUTS, 'def.yaml': BASE + OUTPUTS })).toContain(
      'Both def.yml and def.yaml exist',
    )
    expect(await refusal({ 'def.yml': 'a: [' })).toContain('def.yml')
    expect(await refusal({ 'def.yml': '- a' })).toContain('must be a YAML mapping')
    expect(await refusal({}, '../x')).toContain('plain word')
    expect(await refusal({ 'def.yml/inner': '' })).toContain('EISDIR')
  })

  it('refuses an unknown key, and names each key it does not run', async () => {
    const message = await refusal({
      'def.yml': `${BASE}${OUTPUTS}prompt: Q
colour: red
inputs: {}
tools: []
budget: 1
`,
    })
    expect(message).toContain("Unknown key 'colour'")
    for (const key of ['inputs', 'tools', 'budget']) {
      expect(message).toContain(`'${key}' is not supported`)
    }
    expect(message).not.toContain("Unknown key 'inputs'")
  })

  it('refuses a missing field, a bad version and a doubled or missing prompt', async () => {
    const message = await refusal({ 'def.yml': 'version: 2\nprompt: 1\nmodel: 3\n' })
    expect(message).toContain('version must be 1')
    expect(message).toContain('description is required')
    expect(message).toContain('model is required')
    expect(message).toContain('prompt must be a string')
    expect(message).toContain('outputs must name one')
    expect(await refusal({ 'def.yml': BASE + OUTPUTS })).toContain('exactly one of prompt')
    const both = { 'def.yml': `${BASE}${OUTPUTS}prompt: Q\n`, 'prompt.md': 'Q' }
    expect(await refusal(both)).toContain('exactly one of prompt')
  })

  it('refuses an invalid output', async () => {
    const outputs = (body: string) => ({ 'def.yml': `${BASE}prompt: Q\noutputs:\n${body}` })
    expect(await refusal(outputs('  bad name: { type: numeric, min: 0, max: 1 }\n'))).toContain(
      'plain word',
    )
    for (const name of ['__proto__', '_a', 'severity']) {
      const body = `  ${name}: { type: numeric, min: 0, max: 1 }\n`
      expect(await refusal(outputs(body))).toContain('plain word')
    }
    expect(await refusal(outputs('  a: yes\n'))).toContain('must be a mapping')
    expect(await refusal(outputs('  a: { type: text }\n'))).toContain('type must be')
    expect(await refusal(outputs('  a: { type: numeric, min: 5, max: 1 }\n'))).toContain('min')
    expect(await refusal(outputs('  a: { type: numeric, min: 0.5, max: 1 }\n'))).toContain('min')
    expect(
      await refusal(outputs('  a: { type: numeric, min: 0, max: 1, values: [a] }\n')),
    ).toContain("Unknown key 'values'")
    expect(await refusal(outputs('  a: { type: criteria, values: [] }\n'))).toContain('distinct')
    expect(await refusal(outputs('  a: { type: criteria, values: [x, x] }\n'))).toContain(
      'distinct',
    )
    expect(await refusal(outputs('  a: { type: criteria, values: [1] }\n'))).toContain('distinct')
    expect(await refusal(outputs('  a: { type: criteria, values: x }\n'))).toContain('distinct')
    expect(await refusal(outputs('  a: { type: ordinal, values: [x], min: 1 }\n'))).toContain(
      "Unknown key 'min'",
    )
  })
})
