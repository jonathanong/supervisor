import type { ClassifierOutput } from './classifier-def.js'
import { isPlainObject } from './locals.js'
import type { ClassifierResult } from './types.js'

function allowed(output: ClassifierOutput, value: unknown): value is string | number {
  if (output.type === 'numeric') {
    return (
      Number.isInteger(value) && (value as number) >= output.min && (value as number) <= output.max
    )
  }
  return typeof value === 'string' && output.values.includes(value)
}

/**
 * A classifier result from an answer's text, checked against the outputs the definition allows.
 * A string is the reason the answer is no result: it is not JSON, or an output is missing,
 * unknown, or outside its allowed values.
 *
 * One output is also the result's `value`, which a bare `repo/<name>` reads; every output is in
 * `outputs`, which `repo/<name>.<output>` reads.
 */
export function checkAnswer(
  outputs: Record<string, ClassifierOutput>,
  text: string,
): ClassifierResult | string {
  let answer: unknown
  try {
    answer = JSON.parse(text)
  } catch {
    return 'the answer is not JSON'
  }
  if (!isPlainObject(answer)) return 'the answer is not a JSON object'
  const given = Object.keys(answer).find((name) => !Object.hasOwn(outputs, name))
  if (given !== undefined) return `the answer names '${given}', which is not an output`
  const result: Record<string, string | number> = {}
  for (const [name, output] of Object.entries(outputs)) {
    const value = Object.hasOwn(answer, name) ? answer[name] : undefined
    if (!allowed(output, value)) return `output '${name}' is missing or not an allowed value`
    result[name] = value
  }
  const values = Object.values(result)
  return {
    status: 'complete',
    ...(values.length === 1 ? { value: values[0]! } : {}),
    outputs: result,
  }
}
