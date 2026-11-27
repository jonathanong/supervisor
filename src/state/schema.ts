import { readFileSync } from 'node:fs'
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'

export type Kind = 'string' | 'object' | 'array'

const schema = JSON.parse(
  readFileSync(new URL('../../schemas/state.json', import.meta.url), 'utf8'),
) as { $id: string; properties: Record<string, { type: Kind }> }

/** The top-level fields and their kinds, read from `schemas/state.json`, which is the source. */
export const FIELDS: Record<string, Kind> = Object.fromEntries(
  Object.entries(schema.properties).map(([name, property]) => [name, property.type]),
)

const ajv = new Ajv2020({ strict: true }).addSchema(schema)
const validators = new Map<string, ValidateFunction>()

function validatorOf(name: string): ValidateFunction {
  let validate = validators.get(name)
  if (validate === undefined) {
    validate = ajv.getSchema(`${schema.$id}#/properties/${name}`)!
    validators.set(name, validate)
  }
  return validate
}

/** Names are JSON-quoted so a control character in a key cannot break the one-line message. */
function describe(name: string, error: ErrorObject): string {
  const path = [name, ...error.instancePath.split('/').slice(1)].join('.')
  const extra =
    error.keyword === 'additionalProperties'
      ? ` (${JSON.stringify((error.params as { additionalProperty: string }).additionalProperty)})`
      : ''
  return `${path} ${error.message!}${extra}`
}

/** One line naming the first way a top-level field breaks the schema, or undefined when it fits. */
export function fieldProblem(name: string, value: unknown): string | undefined {
  if (!Object.hasOwn(FIELDS, name)) {
    return `${name} is not a state field`
  }
  const validate = validatorOf(name)
  return validate(value) ? undefined : describe(name, validate.errors![0]!)
}
