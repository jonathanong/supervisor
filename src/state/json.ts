export type Json = null | boolean | number | string | Json[] | JsonObject
export interface JsonObject {
  [key: string]: Json
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An own property only: a key such as `__proto__` or `constructor` never reads the prototype. */
export function get(holder: JsonObject, key: string): Json | undefined {
  return Object.hasOwn(holder, key) ? holder[key] : undefined
}

/** Define an own property, so a key such as `__proto__` is stored as data. */
export function put(holder: JsonObject, key: string, value: Json): void {
  Object.defineProperty(holder, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

function ascii(text: string): string {
  return text.replace(
    /[\u0080-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

/**
 * One line of ASCII JSON. The default puts a space after `,` and `:`, the format the state
 * commands have always printed; `compact` leaves the spaces out.
 */
export function dumps(value: Json, compact = false): string {
  const [comma, colon] = compact ? [',', ':'] : [', ', ': ']
  if (Array.isArray(value)) {
    return `[${value.map((item) => dumps(item, compact)).join(comma)}]`
  }
  if (isObject(value)) {
    const members = Object.entries(value).map(
      ([key, item]) => `${ascii(JSON.stringify(key))}${colon}${dumps(item, compact)}`,
    )
    return `{${members.join(comma)}}`
  }
  return ascii(JSON.stringify(value))
}

/** ASCII JSON indented by two spaces, the format of `state.json` and `state show`. */
export function dumpsIndented(value: Json): string {
  return ascii(JSON.stringify(value, null, 2))
}
