import { readFileSync } from 'node:fs'
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js'

export type Kind = 'string' | 'object' | 'array'

const schema = JSON.parse(
  readFileSync(new URL('../../schemas/state.json', import.meta.url), 'utf8'),
) as { properties: Record<string, { type: Kind }> }

/** The top-level fields and their kinds, read from `schemas/state.json`, which is the source. */
export const FIELDS: Record<string, Kind> = Object.fromEntries(
  Object.entries(schema.properties).map(([name, property]) => [name, property.type]),
)

const validate = new Ajv2020({ strict: true }).compile(schema)

function describe(error: ErrorObject): string {
  const path = error.instancePath.slice(1).replaceAll('/', '.')
  const extra =
    error.keyword === 'additionalProperties'
      ? ` (${(error.params as { additionalProperty: string }).additionalProperty})`
      : ''
  return `${path === '' ? '' : `${path} `}${error.message!}${extra}`
}

/** One line naming the first way `state` breaks the schema, or undefined when it is valid. */
export function stateProblem(state: unknown): string | undefined {
  return validate(state) ? undefined : describe(validate.errors![0]!)
}
